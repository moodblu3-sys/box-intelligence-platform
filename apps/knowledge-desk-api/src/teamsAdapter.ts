import type { KnowledgeDeskQueryRequest, KnowledgeDeskResponse } from "./types.ts";

export interface TeamsMessageRequest {
  text?: string;
  value?: {
    question?: string;
  };
  from?: {
    id?: string;
    name?: string;
    userPrincipalName?: string;
    aadObjectId?: string;
  };
  channelId?: string;
}

export interface TeamsMessageResponse {
  type: "message";
  text: string;
  knowledgeDesk: KnowledgeDeskResponse;
}

export function teamsMessageToKnowledgeDeskRequest(
  request: TeamsMessageRequest
): KnowledgeDeskQueryRequest {
  const question = (request.value?.question ?? request.text ?? "").trim();
  const user =
    request.from?.userPrincipalName ??
    request.from?.id ??
    request.from?.aadObjectId ??
    request.from?.name ??
    "unknown-teams-user";

  return {
    user,
    channel: request.channelId ?? "teams",
    question,
  };
}

export function knowledgeDeskResponseToTeamsMessage(
  response: KnowledgeDeskResponse
): TeamsMessageResponse {
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
