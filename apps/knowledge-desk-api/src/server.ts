import {
  createJiraClientFromEnv,
  type JiraClient,
} from "./clients/jiraClient.ts";
import {
  createTeamsBotClientFromEnv,
  type TeamsBotClient,
} from "./clients/teamsBotClient.ts";
import { MockOnyxClient } from "./clients/mockOnyxClient.ts";
import type { OnyxClient } from "./clients/onyxClient.ts";
import { createRealOnyxClientFromEnv } from "./clients/realOnyxClient.ts";
import { KnowledgeDeskValidationError, queryKnowledgeDesk } from "./queryService.ts";
import {
  createMessageIntentClassifierFromEnv,
  extractActivityValueText,
  normalizeActionText,
  type MessageIntentClassifier,
  type MessageIntentResult,
} from "./messageIntentClassifier.ts";
import {
  isTeamsBotMessageActivity,
  knowledgeDeskResponseToTeamsBotMessage,
  teamsBotActivityToKnowledgeDeskRequest,
  type TeamsBotActivity,
} from "./teamsBotActivityAdapter.ts";
import {
  knowledgeDeskResponseToTeamsMessage,
  teamsMessageToKnowledgeDeskRequest,
  type TeamsMessageRequest,
} from "./teamsAdapter.ts";
import type {
  JiraTicketDraft,
  KnowledgeDeskQueryRequest,
  KnowledgeDeskResponse,
} from "./types.ts";

interface TeamsConversationState {
  request: KnowledgeDeskQueryRequest;
  response: KnowledgeDeskResponse;
  updatedAt: Date;
}

interface KnowledgeDeskAppOptions {
  onyxClient?: OnyxClient;
  jiraClient?: JiraClient;
  teamsBotClient?: TeamsBotClient;
  messageIntentClassifier?: MessageIntentClassifier;
}

export function createKnowledgeDeskApp(options: KnowledgeDeskAppOptions = {}) {
  const onyxClient = options.onyxClient ?? createOnyxClientFromEnv();
  const jiraClient = options.jiraClient ?? createJiraClientFromEnv();
  const teamsBotClient =
    options.teamsBotClient ?? createTeamsBotClientFromEnv();
  const messageIntentClassifier =
    options.messageIntentClassifier ?? createMessageIntentClassifierFromEnv();
  const teamsConversationState = new Map<string, TeamsConversationState>();

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return jsonResponse({}, 204);
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ status: "ok", service: "knowledge-desk-api" });
      }

      if (
        url.pathname !== "/api/knowledge-desk/query" &&
        url.pathname !== "/api/knowledge-desk/teams/message" &&
        url.pathname !== "/api/knowledge-desk/teams/bot/messages"
      ) {
        return jsonResponse({ error: "Not found" }, 404);
      }

      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      try {
        const requestBody = await request.json();
        if (url.pathname === "/api/knowledge-desk/teams/bot/messages") {
          const activity = requestBody as TeamsBotActivity;

          if (!isTeamsBotMessageActivity(activity)) {
            return jsonResponse({
              status: "ignored",
              reason: `Unsupported Teams Bot activity type: ${
                activity.type ?? "unknown"
              }`,
            });
          }

          if (shouldDeliverTeamsBotReplyAsync()) {
            void deliverTeamsBotReply(
              activity,
              onyxClient,
              jiraClient,
              teamsBotClient,
              messageIntentClassifier,
              teamsConversationState
            ).catch((error: unknown) => {
              console.error("Teams Bot async reply failed", error);
            });

            return jsonResponse({
              status: "accepted",
              delivery: "async",
            });
          }

          return jsonResponse(
            await deliverTeamsBotReply(
              activity,
              onyxClient,
              jiraClient,
              teamsBotClient,
              messageIntentClassifier,
              teamsConversationState
            )
          );
        }

        const body =
          url.pathname === "/api/knowledge-desk/teams/message"
            ? teamsMessageToKnowledgeDeskRequest(requestBody as TeamsMessageRequest)
            : (requestBody as KnowledgeDeskQueryRequest);
        const result = await queryKnowledgeDesk(body, onyxClient, jiraClient);
        if (url.pathname === "/api/knowledge-desk/teams/message") {
          return jsonResponse(knowledgeDeskResponseToTeamsMessage(result));
        }
        return jsonResponse(result);
      } catch (error) {
        if (error instanceof SyntaxError) {
          return jsonResponse({ error: "Invalid JSON body." }, 400);
        }

        if (error instanceof KnowledgeDeskValidationError) {
          return jsonResponse({ error: error.message }, 400);
        }

        console.error("Knowledge Desk query failed", error);
        return jsonResponse({ error: "Internal server error" }, 500);
      }
    },
  };
}

async function deliverTeamsBotReply(
  activity: TeamsBotActivity,
  onyxClient: OnyxClient,
  jiraClient: JiraClient,
  teamsBotClient: TeamsBotClient,
  messageIntentClassifier: MessageIntentClassifier,
  teamsConversationState: Map<string, TeamsConversationState>
) {
  console.info("Teams Bot message received", {
    activityId: activity.id,
    conversationId: activity.conversation?.id,
    channelId: activity.channelId,
  });
  const conversationId = activity.conversation?.id;
  const state = conversationId
    ? teamsConversationState.get(conversationId)
    : undefined;
  const intent = await classifyTeamsBotIntent(
    activity,
    state,
    messageIntentClassifier
  );
  console.info("Teams Bot intent classified", {
    activityId: activity.id,
    conversationId,
    intent: intent.intent,
    confidence: intent.confidence,
    reason: intent.reason,
  });

  if (intent.intent === "resolution_resolved") {
    return handleResolutionAction(
      "resolved",
      activity,
      jiraClient,
      teamsBotClient,
      teamsConversationState
    );
  }

  if (
    intent.intent === "resolution_unresolved" ||
    intent.intent === "ticket_request"
  ) {
    return handleResolutionAction(
      "unresolved",
      activity,
      jiraClient,
      teamsBotClient,
      teamsConversationState
    );
  }

  if (
    intent.intent === "small_talk" ||
    intent.intent === "conversation_closing" ||
    intent.intent === "unclear"
  ) {
    const text = intent.replyText ?? defaultReplyForIntent(intent);
    const delivery = await teamsBotClient.sendReply({
      activity,
      text,
    });

    return {
      type: "message",
      text,
      delivery,
    };
  }

  const request = teamsBotActivityToKnowledgeDeskRequest(activity);
  const result = await queryKnowledgeDesk(request, onyxClient);
  const message = knowledgeDeskResponseToTeamsBotMessage(result);
  if (conversationId) {
    teamsConversationState.set(conversationId, {
      request,
      response: result,
      updatedAt: new Date(),
    });
  }

  const delivery = await teamsBotClient.sendReply({
    activity,
    text: message.text,
    suggestedActions: message.suggestedActions,
  });

  console.info("Teams Bot reply delivery completed", {
    sent: delivery.sent,
    status: delivery.status,
    error: delivery.error,
  });

  return {
    ...message,
    delivery,
  };
}

async function handleResolutionAction(
  resolutionAction: "resolved" | "unresolved",
  activity: TeamsBotActivity,
  jiraClient: JiraClient,
  teamsBotClient: TeamsBotClient,
  teamsConversationState: Map<string, TeamsConversationState>
) {
  const conversationId = activity.conversation?.id;
  const state = conversationId
    ? teamsConversationState.get(conversationId)
    : undefined;

  if (resolutionAction === "resolved") {
    if (conversationId) {
      teamsConversationState.delete(conversationId);
    }

    const delivery = await teamsBotClient.sendReply({
      activity,
      text: "解決できてよかったです。必要になったらまた聞いてください。",
    });

    return {
      type: "message",
      text: "解決できてよかったです。必要になったらまた聞いてください。",
      delivery,
    };
  }

  if (!state) {
    const text = [
      "直前の問い合わせ内容が見つからなかったため、Jira起票に必要な情報を特定できませんでした。",
      "もう一度問い合わせ内容を送ってから、`解決しません` と返信してください。",
    ].join("\n");
    const delivery = await teamsBotClient.sendReply({
      activity,
      text,
    });

    return {
      type: "message",
      text,
      delivery,
    };
  }

  const draft = buildUnresolvedJiraTicketDraft(state.request, state.response);
  const jiraTicket = await jiraClient.createIssue({
    draft,
    requester: state.request.user,
    question: state.request.question,
  });
  const ticketLine = jiraTicket.url
    ? `Jiraに起票しました: ${jiraTicket.url}`
    : jiraTicket.dryRun
      ? "Jira起票はDRY_RUNです。デモ設定を確認してください。"
      : `Jira起票に失敗しました: ${jiraTicket.error ?? "unknown error"}`;
  const text = [
    "承知しました。情シスで確認できるように問い合わせを起票しました。",
    "",
    ticketLine,
  ].join("\n");
  const delivery = await teamsBotClient.sendReply({
    activity,
    text,
  });
  if (conversationId) {
    teamsConversationState.delete(conversationId);
  }

  return {
    type: "message",
    text,
    jiraTicket,
    delivery,
  };
}

async function classifyTeamsBotIntent(
  activity: TeamsBotActivity,
  state: TeamsConversationState | undefined,
  messageIntentClassifier: MessageIntentClassifier
): Promise<MessageIntentResult> {
  const text = normalizeActionText(activity.text);
  const value = normalizeActionText(extractActivityValueText(activity.value));

  return messageIntentClassifier.classify({
    text,
    actionText: value,
    channel: activity.channelId ?? "msteams",
    hasPendingAnswer: state !== undefined,
    previousQuestion: state?.request.question ?? null,
  });
}

function defaultReplyForIntent(intent: MessageIntentResult): string {
  if (intent.intent === "conversation_closing") {
    return "はい。いつでも聞いてください。";
  }

  if (intent.intent === "unclear") {
    return "確認したい内容をもう少し具体的に教えてください。";
  }

  return "どういたしまして。必要になったらまた聞いてください。";
}

function buildUnresolvedJiraTicketDraft(
  request: KnowledgeDeskQueryRequest,
  response: KnowledgeDeskResponse
): JiraTicketDraft {
  const isBoxExternalSharing = isLikelyBoxExternalSharing(request.question);
  const title = isBoxExternalSharing
    ? "Box外部共有: 取引先ユーザーがアクセスできない"
    : "社内問い合わせ: Bot回答後も未解決";
  const labels = isBoxExternalSharing
    ? ["box", "external-sharing", "knowledge-desk", "teams-unresolved"]
    : ["knowledge-desk", "teams-unresolved", "needs-triage"];
  const confirmationItems = isBoxExternalSharing
    ? [
        "- 対象BoxフォルダのURL",
        "- 招待先メールアドレス",
        "- 取引先ドメイン",
        "- フォルダの機密区分",
        "- 共有リンク利用有無",
        "- 表示されているエラーメッセージ",
      ]
    : [
        "- 事象の発生日時",
        "- 対象システムまたはサービス",
        "- 利用者の操作手順",
        "- 表示されているエラーメッセージ",
        "- 影響範囲と緊急度",
      ];

  return {
    title,
    description: [
      "受付概要",
      `- 問い合わせ種別: ${isBoxExternalSharing ? "Box外部共有" : "社内問い合わせ"}`,
      "- ステータス: Bot回答後も未解決",
      `問い合わせ元: ${request.user}`,
      `受付チャネル: ${request.channel}`,
      "",
      "問い合わせ内容:",
      request.question,
      "",
      "利用者フィードバック:",
      "- Bot回答では解決しない",
      "",
      "Bot回答サマリー:",
      summarizeBotAnswerForTicket(request, response),
      "",
      "主な参照元:",
      ...formatTicketSources(response),
      "",
      "情シスで確認してほしいこと:",
      ...confirmationItems,
      "",
      `担当チーム: ${isBoxExternalSharing ? "Corporate IT / Box管理" : "Corporate IT"}`,
    ].join("\n"),
    priority: "Medium",
    labels,
    assigneeTeam: isBoxExternalSharing ? "Corporate IT / Box管理" : "Corporate IT",
  };
}

function summarizeBotAnswerForTicket(
  request: KnowledgeDeskQueryRequest,
  response: KnowledgeDeskResponse
): string {
  if (isLikelyBoxExternalSharing(request.question)) {
    return [
      "Botは、招待先メールアドレス、相手のログインアカウント、招待メールの受信状況、フォルダ機密区分、取引先ドメイン許可を確認するよう案内。",
      "利用者は回答後も未解決と回答したため、情シスで個別確認が必要。",
    ].join("\n");
  }

  return stripTicketMarkdown(response.answer).slice(0, 500);
}

function formatTicketSources(response: KnowledgeDeskResponse): string[] {
  if (response.sources.length === 0) {
    return ["- なし"];
  }

  return response.sources
    .slice(0, 5)
    .map((source) => `- ${source.source}: ${source.title} ${source.url}`);
}

function stripTicketMarkdown(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("|"))
    .filter((line) => !/^[-:| ]+$/.test(line.trim()))
    .join("\n")
    .replace(/[#*_>`[\]✅⚠️🔴🟡🚨📋💡📁🔍]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isLikelyBoxExternalSharing(question: string): boolean {
  const terms = ["Box", "box", "共有", "外部", "取引先", "フォルダ"];
  return terms.filter((term) => question.includes(term)).length >= 2;
}

function createOnyxClientFromEnv(): OnyxClient {
  const mode = process.env.KNOWLEDGE_DESK_ONYX_MODE ?? "mock";

  if (mode === "mock") {
    return new MockOnyxClient();
  }

  if (mode === "real") {
    return createRealOnyxClientFromEnv();
  }

  throw new Error(
    `Unsupported KNOWLEDGE_DESK_ONYX_MODE: ${mode}. Use "mock" or "real".`
  );
}

function shouldDeliverTeamsBotReplyAsync(): boolean {
  return (process.env.TEAMS_BOT_REPLY_MODE ?? "http").toLowerCase() === "connector";
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
  });
}
