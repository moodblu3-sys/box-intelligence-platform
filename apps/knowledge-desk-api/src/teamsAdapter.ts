import type { KnowledgeDeskQueryRequest, KnowledgeDeskResponse } from "./types.ts";
import { knowledgeDeskResponseToTeamsBotMessage } from "./teamsBotActivityAdapter.ts";

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
  const teamsMessage = knowledgeDeskResponseToTeamsBotMessage(response);

  return {
    type: "message",
    text: teamsMessage.text,
    knowledgeDesk: response,
  };
}
