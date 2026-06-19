import {
  createJiraClientFromEnv,
  type JiraClient,
} from "./clients/jiraClient.ts";
import { MockOnyxClient } from "./clients/mockOnyxClient.ts";
import type { OnyxClient } from "./clients/onyxClient.ts";
import { createRealOnyxClientFromEnv } from "./clients/realOnyxClient.ts";
import { KnowledgeDeskValidationError, queryKnowledgeDesk } from "./queryService.ts";
import {
  knowledgeDeskResponseToTeamsMessage,
  teamsMessageToKnowledgeDeskRequest,
  type TeamsMessageRequest,
} from "./teamsAdapter.ts";
import type { KnowledgeDeskQueryRequest } from "./types.ts";

interface KnowledgeDeskAppOptions {
  onyxClient?: OnyxClient;
  jiraClient?: JiraClient;
}

export function createKnowledgeDeskApp(options: KnowledgeDeskAppOptions = {}) {
  const onyxClient = options.onyxClient ?? createOnyxClientFromEnv();
  const jiraClient = options.jiraClient ?? createJiraClientFromEnv();

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
        url.pathname !== "/api/knowledge-desk/teams/message"
      ) {
        return jsonResponse({ error: "Not found" }, 404);
      }

      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      try {
        const requestBody = await request.json();
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
