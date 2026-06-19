import type { KnowledgeDeskQueryRequest, KnowledgeDeskResponse } from "./types.ts";

export interface TeamsBotActivity {
  type?: string;
  id?: string;
  text?: string;
  textFormat?: string;
  value?: unknown;
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
  suggestedActions?: TeamsBotSuggestedAction[];
}

export interface TeamsBotSuggestedAction {
  type: "imBack";
  title: string;
  value: string;
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
    activity.from?.name ??
    activity.from?.id ??
    activity.from?.aadObjectId ??
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
  const textParts = [formatTeamsAnswer(response), formatSources(response)];

  if (response.needsEscalation) {
    textParts.push(formatEscalation(response));
  } else {
    textParts.push(formatResolutionPrompt());
  }

  return {
    type: "message",
    text: textParts
      .filter((part) => part.trim().length > 0)
      .join("\n\n---\n\n"),
    knowledgeDesk: response,
    suggestedActions: response.needsEscalation
      ? [
          {
            type: "imBack",
            title: "起票して",
            value: "起票して",
          },
        ]
      : [
          {
            type: "imBack",
            title: "解決しました",
            value: "解決しました",
          },
          {
            type: "imBack",
            title: "解決しません",
            value: "解決しません",
          },
        ],
  };
}

function formatTeamsAnswer(response: KnowledgeDeskResponse): string {
  if (isBoxExternalSharingAnswer(response)) {
    return [
      "**Box外部共有の確認手順**",
      "",
      "まず、招待メール、ログイン中のメールアドレス、フォルダ設定、取引先ドメインの許可状況を確認してください。",
      "",
      "1. 招待先メールアドレスに誤りがないか",
      "2. 相手が招待されたメールアドレスでBoxにログインしているか",
      "3. 招待メールが迷惑メールに入っていないか、有効期限が切れていないか",
      "4. フォルダの機密区分が外部共有可能か",
      "5. 共有リンクではなく外部コラボレーター招待が必要なケースか",
      "6. 取引先ドメインが外部共有許可リストに登録済みか",
      "",
      "**情シスへ引き継ぐ条件**",
      "",
      "- 取引先ドメインが未登録",
      "- フォルダが社外秘以上",
      "- フォルダオーナーが退職済み、または不明",
      "- 個人情報、契約書、設計資料を含む",
      "- 権限やポリシー制限のエラーが出ている",
      "",
      "**取引先への案内例**",
      "",
      "招待メールの宛先と、Boxにログインしているメールアドレスが同じか確認してください。迷惑メールフォルダと招待メールの有効期限も確認してください。",
    ].join("\n");
  }

  return trimForTeams(stripMarkdownTables(response.answer));
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
    "主な参照元",
    "",
    ...selectDisplaySources(response).map(
      (source, index) =>
        `${index + 1}. ${source.source}: ${formatSourceTitle(source.title, source.url)}`
    ),
  ].join("\n");
}

function formatResolutionPrompt(): string {
  return [
    "この回答で解決しましたか？",
    "",
    "下のボタン、または「解決しました」「解決しません」と返信してください。",
  ].join("\n");
}

function formatEscalation(response: KnowledgeDeskResponse): string {
  if (!response.needsEscalation) {
    return "";
  }

  const jiraLine = response.jiraTicketUrl
    ? `Jiraに起票済み: ${response.jiraTicketUrl}`
    : response.jiraTicket?.dryRun
      ? "Jira起票: DRY_RUN"
      : "必要であれば、下のボタン、または「起票して」と返信してください。";

  return [
    "**情シス確認が必要です**",
    response.escalationReason ?? "情シス部門で確認が必要です。",
    jiraLine,
  ].join("\n");
}

function isBoxExternalSharingAnswer(response: KnowledgeDeskResponse): boolean {
  const text = [
    response.answer,
    ...response.sources.map((source) => `${source.title} ${source.snippet ?? ""}`),
  ].join(" ");

  return text.includes("Box") && text.includes("外部共有");
}

function selectDisplaySources(response: KnowledgeDeskResponse) {
  const displayableSources = response.sources.filter(isDisplayableSource);
  const candidates =
    displayableSources.length > 0 ? displayableSources : response.sources;
  const firstBySource = new Map<string, (typeof candidates)[number]>();

  for (const source of candidates) {
    if (!firstBySource.has(source.source)) {
      firstBySource.set(source.source, source);
    }
  }

  const selected = [...firstBySource.values()];
  for (const source of candidates) {
    if (selected.length >= 4) {
      break;
    }

    if (!selected.includes(source)) {
      selected.push(source);
    }
  }

  return selected;
}

function isDisplayableSource(source: KnowledgeDeskResponse["sources"][number]): boolean {
  const title = source.title.toLowerCase();
  const isDemoTestDocument =
    title.includes("mvp") ||
    title.includes("index test") ||
    title.includes("codex");

  if (isDemoTestDocument) {
    return false;
  }

  if (typeof source.score === "number" && source.score < 0.3) {
    return false;
  }

  return true;
}

function formatSourceTitle(title: string, url: string): string {
  if (/^https?:\/\//.test(url)) {
    return `[${title}](${url})`;
  }

  return title;
}

function stripMarkdownTables(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("|"))
    .filter((line) => !/^[-:| ]+$/.test(line.trim()))
    .join("\n");
}

function trimForTeams(text: string): string {
  const normalized = text
    .replace(/[✅⚠️🔴🟡🚨📋📁🔍💡]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (normalized.length <= 1400) {
    return normalized;
  }

  return `${normalized.slice(0, 1400).trim()}\n\n詳細は参照元を確認してください。`;
}
