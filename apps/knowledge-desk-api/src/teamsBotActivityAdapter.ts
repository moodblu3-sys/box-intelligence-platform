import type { KnowledgeDeskQueryRequest, KnowledgeDeskResponse } from "./types.ts";

export interface TeamsBotActivity {
  type?: string;
  id?: string;
  text?: string;
  textFormat?: string;
  serviceUrl?: string;
  channelId?: string;
  conversation?: {
    id?: string;
  };
  from?: {
    id?: string;
    name?: string;
    aadObjectId?: string;
    userPrincipalName?: string;
  };
  recipient?: {
    id?: string;
    name?: string;
  };
}

export interface TeamsBotMessageResponse {
  type: "message";
  text: string;
  knowledgeDesk: KnowledgeDeskResponse;
}

export function isTeamsBotMessageActivity(activity: TeamsBotActivity): boolean {
  return (activity.type ?? "").toLowerCase() === "message";
}

export function teamsBotActivityToKnowledgeDeskRequest(
  activity: TeamsBotActivity
): KnowledgeDeskQueryRequest {
  const question = normalizeTeamsText(activity.text ?? "");
  const user =
    activity.from?.userPrincipalName ??
    activity.from?.aadObjectId ??
    activity.from?.id ??
    activity.from?.name ??
    "unknown-teams-user";

  return {
    user,
    channel: activity.channelId ?? "msteams",
    question,
  };
}

export function knowledgeDeskResponseToTeamsBotMessage(
  response: KnowledgeDeskResponse
): TeamsBotMessageResponse {
  return {
    type: "message",
    text: [
      response.answer,
      "",
      formatSources(response),
      formatEscalation(response),
    ]
      .filter((part) => part.trim().length > 0)
      .join("\n"),
    knowledgeDesk: response,
  };
}

function normalizeTeamsText(text: string): string {
  return text
    .replace(/<at>.*?<\/at>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatSources(response: KnowledgeDeskResponse): string {
  if (response.sources.length === 0) {
    return "";
  }

  return [
    "参照元:",
    ...response.sources.map(
      (source, index) =>
        `${index + 1}. [${source.source}] ${source.title} ${source.url}`
    ),
  ].join("\n");
}

function formatEscalation(response: KnowledgeDeskResponse): string {
  if (!response.needsEscalation) {
    return "";
  }

  const jiraLine = response.jiraTicketUrl
    ? `Jira起票: ${response.jiraTicketUrl}`
    : response.jiraTicket?.dryRun
      ? "Jira起票: DRY_RUN"
      : "Jira起票: 未作成";

  return [
    "エスカレーション:",
    response.escalationReason ?? "情シス部門で確認が必要です。",
    jiraLine,
  ].join("\n");
}
