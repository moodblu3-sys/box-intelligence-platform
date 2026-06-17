import type { OnyxClient } from "./clients/onyxClient.ts";
import type { KnowledgeDeskQueryRequest, KnowledgeDeskResponse } from "./types.ts";
import { normalizeKnowledgeDeskResponse } from "./normalizer.ts";

const KNOWLEDGE_DESK_SOURCES = ["Box", "SharePoint", "Jira"] as const;

export class KnowledgeDeskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeDeskValidationError";
  }
}

export async function queryKnowledgeDesk(
  request: KnowledgeDeskQueryRequest,
  onyxClient: OnyxClient
): Promise<KnowledgeDeskResponse> {
  validateRequest(request);

  const onyxResult = await onyxClient.query({
    user: request.user.trim(),
    channel: request.channel.trim(),
    question: request.question.trim(),
    sources: [...KNOWLEDGE_DESK_SOURCES],
  });

  return normalizeKnowledgeDeskResponse(request, onyxResult);
}

function validateRequest(request: KnowledgeDeskQueryRequest): void {
  if (!request || typeof request !== "object") {
    throw new KnowledgeDeskValidationError("Request body must be a JSON object.");
  }

  if (!request.user || typeof request.user !== "string") {
    throw new KnowledgeDeskValidationError("user is required.");
  }

  if (!request.channel || typeof request.channel !== "string") {
    throw new KnowledgeDeskValidationError("channel is required.");
  }

  if (!request.question || typeof request.question !== "string") {
    throw new KnowledgeDeskValidationError("question is required.");
  }

  if (request.question.trim().length < 5) {
    throw new KnowledgeDeskValidationError("question is too short.");
  }
}
