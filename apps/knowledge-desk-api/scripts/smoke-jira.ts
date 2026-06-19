import { createKnowledgeDeskApp } from "../src/server.ts";
import type { KnowledgeDeskResponse } from "../src/types.ts";

const ESCALATION_QUESTION =
  "社内VPNが海外出張先からつながりません。原因を教えてください。";

process.env.KNOWLEDGE_DESK_ONYX_MODE =
  process.env.KNOWLEDGE_DESK_ONYX_MODE ?? "mock";

async function main() {
  const expectRealIssue = process.env.JIRA_DRY_RUN === "false";
  const app = createKnowledgeDeskApp();
  const response = await app.fetch(
    new Request("http://localhost/api/knowledge-desk/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: process.env.SMOKE_USER ?? "suzuki@nisshin-tech.example",
        channel: "teams",
        question: process.env.SMOKE_ESCALATION_QUESTION ?? ESCALATION_QUESTION,
      }),
    })
  );

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(`Knowledge Desk API returned ${response.status}: ${rawBody}`);
  }

  const body = JSON.parse(rawBody) as KnowledgeDeskResponse;
  validateEscalation(body, expectRealIssue);
  printSummary(body);
}

function validateEscalation(
  body: KnowledgeDeskResponse,
  expectRealIssue: boolean
): void {
  if (!body.needsEscalation) {
    throw new Error("Expected needsEscalation=true.");
  }

  if (!body.jiraTicketDraft) {
    throw new Error("Expected jiraTicketDraft.");
  }

  if (!body.jiraTicket) {
    throw new Error("Expected jiraTicket result.");
  }

  if (body.jiraTicket.error) {
    throw new Error(body.jiraTicket.error);
  }

  if (expectRealIssue) {
    if (!body.jiraTicket.created || !body.jiraTicketUrl) {
      throw new Error("Expected a real Jira issue and jiraTicketUrl.");
    }
  } else if (!body.jiraTicket.dryRun) {
    throw new Error("Expected JIRA_DRY_RUN=true dry-run result.");
  }
}

function printSummary(body: KnowledgeDeskResponse): void {
  console.log("Knowledge Desk Jira smoke succeeded.");
  console.log(`needsEscalation=${body.needsEscalation}`);
  console.log(`confidence=${body.confidence}`);
  console.log(`dryRun=${body.jiraTicket?.dryRun ?? "n/a"}`);
  console.log(`created=${body.jiraTicket?.created ?? "n/a"}`);
  console.log(`jiraTicketKey=${body.jiraTicket?.key ?? "n/a"}`);
  console.log(`jiraTicketUrl=${body.jiraTicketUrl ?? "n/a"}`);
  console.log(`title=${body.jiraTicketDraft?.title ?? "n/a"}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
