import { createKnowledgeDeskApp } from "../src/server.ts";
import type { KnowledgeDeskResponse, SourceName } from "../src/types.ts";

const DEMO_QUESTION =
  "取引先にBoxフォルダを共有したいのですが、相手からアクセスできないと言われています。外部共有の条件と、確認すべき手順を教えてください。";
const DEFAULT_EXPECTED_SOURCES = "Box,Jira";
const DEFAULT_MIN_SNIPPET_LENGTH = 20;

process.env.KNOWLEDGE_DESK_ONYX_MODE = "real";

const expectedSources = parseExpectedSources(
  process.env.SMOKE_EXPECTED_SOURCES ?? DEFAULT_EXPECTED_SOURCES
);
const minConfidence = Number(
  process.env.SMOKE_MIN_CONFIDENCE ??
    (expectedSources.includes("SharePoint") ? "0.75" : "0.6")
);
const minSnippetLength = Number(
  process.env.SMOKE_MIN_SNIPPET_LENGTH ?? String(DEFAULT_MIN_SNIPPET_LENGTH)
);
const allowEscalation = process.env.SMOKE_ALLOW_ESCALATION === "true";

async function main() {
  assertRequiredEnv("ONYX_BASE_URL");
  assertRequiredEnv("ONYX_API_KEY");

  const app = createKnowledgeDeskApp();
  const response = await app.fetch(
    new Request("http://localhost/api/knowledge-desk/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: process.env.SMOKE_USER ?? "suzuki@nisshin-tech.example",
        channel: "teams",
        question: process.env.SMOKE_QUESTION ?? DEMO_QUESTION,
      }),
    })
  );

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(`Knowledge Desk API returned ${response.status}: ${rawBody}`);
  }

  const body = JSON.parse(rawBody) as KnowledgeDeskResponse;
  validateResponse(body);
  printSummary(body);
}

function validateResponse(body: KnowledgeDeskResponse): void {
  const observedSources = new Set(body.sources.map((source) => source.source));
  const missingSources = expectedSources.filter(
    (source) => !observedSources.has(source)
  );
  if (missingSources.length > 0) {
    throw new Error(`Missing expected sources: ${missingSources.join(", ")}`);
  }

  const sourcesMissingSnippets = expectedSources.filter(
    (source) =>
      !body.sources.some(
        (candidate) =>
          candidate.source === source &&
          (candidate.snippet?.trim().length ?? 0) >= minSnippetLength
      )
  );
  if (sourcesMissingSnippets.length > 0) {
    throw new Error(
      `Sources missing usable snippets: ${sourcesMissingSnippets.join(", ")}`
    );
  }

  const sourcesMissingScores = expectedSources.filter(
    (source) =>
      !body.sources.some(
        (candidate) =>
          candidate.source === source && typeof candidate.score === "number"
      )
  );
  if (sourcesMissingScores.length > 0) {
    throw new Error(
      `Sources missing numeric scores: ${sourcesMissingScores.join(", ")}`
    );
  }

  if (body.confidence < minConfidence) {
    throw new Error(
      `Confidence ${body.confidence} is below expected minimum ${minConfidence}`
    );
  }

  if (body.needsEscalation && !allowEscalation) {
    throw new Error(
      `Unexpected escalation: ${body.escalationReason ?? "reason not provided"}`
    );
  }
}

function printSummary(body: KnowledgeDeskResponse): void {
  console.log("Knowledge Desk real-mode smoke succeeded.");
  console.log(`confidence=${body.confidence}`);
  console.log(`needsEscalation=${body.needsEscalation}`);
  console.log(
    `sources=${body.sources
      .map(
        (source) =>
          `${source.source}:${source.title}:snippet=${source.snippet?.length ?? 0}:score=${source.score ?? "n/a"}`
      )
      .join(" | ")}`
  );
}

function parseExpectedSources(value: string): SourceName[] {
  const allowed = new Set<SourceName>(["Box", "SharePoint", "Jira"]);
  const sources = value
    .split(",")
    .map((source) => source.trim())
    .filter((source) => source.length > 0);

  if (sources.length === 0) {
    throw new Error("SMOKE_EXPECTED_SOURCES must include at least one source.");
  }

  for (const source of sources) {
    if (!allowed.has(source as SourceName)) {
      throw new Error(
        `Unsupported source in SMOKE_EXPECTED_SOURCES: ${source}. Use Box, SharePoint, Jira.`
      );
    }
  }

  return sources as SourceName[];
}

function assertRequiredEnv(name: string): void {
  if (!process.env[name]) {
    throw new Error(`${name} is required for npm run smoke:real.`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
