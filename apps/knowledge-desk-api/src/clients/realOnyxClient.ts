import type { OnyxClient } from "./onyxClient.ts";
import type {
  OnyxQueryInput,
  OnyxQueryResult,
  OnyxSearchResult,
  SourceName,
} from "../types.ts";

type FetchLike = typeof fetch;

interface RealOnyxClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchFn?: FetchLike;
  timeoutMs?: number;
}

interface OnyxChatResponse {
  answer?: unknown;
  answer_citationless?: unknown;
  top_documents?: unknown;
  tool_calls?: unknown;
  error_msg?: unknown;
}

interface OnyxSearchDocument {
  document_id?: unknown;
  semantic_identifier?: unknown;
  link?: unknown;
  blurb?: unknown;
  source_type?: unknown;
  score?: unknown;
  match_highlights?: unknown;
  metadata?: unknown;
}

const SOURCE_TYPE_TO_SOURCE_NAME: Record<string, SourceName> = {
  box: "Box",
  sharepoint: "SharePoint",
  jira: "Jira",
};

const SOURCE_NAME_TO_SOURCE_TYPE: Record<SourceName, string> = {
  Box: "box",
  SharePoint: "sharepoint",
  Jira: "jira",
};

export class RealOnyxClient implements OnyxClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: RealOnyxClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async query(input: OnyxQueryInput): Promise<OnyxQueryResult> {
    const response = await this.postChatMessage(input);
    const answer =
      asString(response.answer_citationless) ?? asString(response.answer) ?? null;

    return {
      answer,
      results: dedupeResults([
        ...extractDocuments(response.top_documents),
        ...extractToolCallDocuments(response.tool_calls),
      ]),
    };
  }

  private async postChatMessage(input: OnyxQueryInput): Promise<OnyxChatResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(
        `${this.baseUrl}/api/chat/send-chat-message`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            message: input.question,
            stream: false,
            include_citations: true,
            origin: "api",
            internal_search_filters: {
              source_type: input.sources.map(
                (source) => SOURCE_NAME_TO_SOURCE_TYPE[source]
              ),
            },
            chat_session_info: {
              persona_id: 0,
              description: `Knowledge Desk: ${input.user}`,
            },
          }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Onyx API request failed: ${response.status} ${response.statusText} ${errorText}`.trim()
        );
      }

      const payload = (await response.json()) as OnyxChatResponse;

      if (typeof payload.error_msg === "string" && payload.error_msg.length > 0) {
        throw new Error(`Onyx API returned an error: ${payload.error_msg}`);
      }

      return payload;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Onyx API request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createRealOnyxClientFromEnv(): RealOnyxClient {
  const baseUrl = process.env.ONYX_BASE_URL;
  const apiKey = process.env.ONYX_API_KEY;

  if (!baseUrl) {
    throw new Error("ONYX_BASE_URL is required when KNOWLEDGE_DESK_ONYX_MODE=real.");
  }

  if (!apiKey) {
    throw new Error("ONYX_API_KEY is required when KNOWLEDGE_DESK_ONYX_MODE=real.");
  }

  return new RealOnyxClient({
    baseUrl,
    apiKey,
    timeoutMs: Number(process.env.ONYX_API_TIMEOUT_MS ?? "60000"),
  });
}

function extractToolCallDocuments(toolCalls: unknown): OnyxSearchResult[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls.flatMap((toolCall) => {
    if (!isRecord(toolCall)) {
      return [];
    }
    return extractDocuments(toolCall.search_docs);
  });
}

function extractDocuments(documents: unknown): OnyxSearchResult[] {
  if (!Array.isArray(documents)) {
    return [];
  }

  return documents
    .map((document) => normalizeSearchDocument(document))
    .filter((result): result is OnyxSearchResult => result !== null);
}

function normalizeSearchDocument(document: unknown): OnyxSearchResult | null {
  if (!isRecord(document)) {
    return null;
  }

  const onyxDocument = document as OnyxSearchDocument;
  const sourceType = asString(onyxDocument.source_type)?.toLowerCase();
  if (!sourceType) {
    return null;
  }

  const source = SOURCE_TYPE_TO_SOURCE_NAME[sourceType];
  if (!source) {
    return null;
  }

  const title =
    asString(onyxDocument.semantic_identifier) ??
    metadataString(onyxDocument.metadata, ["title", "name", "file_name"]) ??
    "Untitled";
  const url =
    asString(onyxDocument.link) ??
    asString(onyxDocument.document_id) ??
    `${source.toLowerCase()}://unknown`;
  const snippet = buildSnippet(onyxDocument);
  const score = typeof onyxDocument.score === "number" ? onyxDocument.score : 0;

  return {
    source,
    title,
    url,
    content: snippet,
    score,
  };
}

function buildSnippet(document: OnyxSearchDocument): string {
  const highlights = document.match_highlights;
  if (Array.isArray(highlights)) {
    const firstHighlight = highlights.find(
      (highlight): highlight is string =>
        typeof highlight === "string" && highlight.trim().length > 0
    );
    if (firstHighlight) {
      return stripHighlightTags(firstHighlight);
    }
  }

  return stripHighlightTags(asString(document.blurb) ?? "");
}

function stripHighlightTags(value: string): string {
  return value.replace(/<\/?hi>/g, "").replace(/\s+/g, " ").trim();
}

function dedupeResults(results: OnyxSearchResult[]): OnyxSearchResult[] {
  const seen = new Set<string>();

  return results.filter((result) => {
    const key = `${result.source}:${result.title}:${result.url}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function metadataString(metadata: unknown, keys: string[]): string | null {
  if (!isRecord(metadata)) {
    return null;
  }

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
