import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createKnowledgeDeskApp } from "../src/server.ts";

const DEMO_QUESTION =
  "取引先にBoxフォルダを共有したいのですが、相手からアクセスできないと言われています。外部共有の条件と、確認すべき手順を教えてください。";

describe("Knowledge Desk API", () => {
  test("returns a multi-source answer without escalation for the demo question", async () => {
    const app = createKnowledgeDeskApp();
    const response = await app.fetch(
      new Request("http://localhost/api/knowledge-desk/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: "suzuki@nisshin-tech.example",
          channel: "teams",
          question: DEMO_QUESTION,
        }),
      })
    );

    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.needsEscalation, false);
    assert.equal(body.jiraTicketDraft, null);
    assert.ok(body.confidence >= 0.8);
    assert.deepEqual(
      body.sources.map((source: { source: string }) => source.source),
      ["Box", "SharePoint", "Jira"]
    );
    assert.match(body.answer, /取引先ドメイン/);
  });

  test("returns an escalation draft when knowledge is insufficient", async () => {
    const app = createKnowledgeDeskApp();
    const response = await app.fetch(
      new Request("http://localhost/api/knowledge-desk/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: "suzuki@nisshin-tech.example",
          channel: "teams",
          question: "社内VPNが海外出張先からつながりません。原因を教えてください。",
        }),
      })
    );

    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.needsEscalation, true);
    assert.ok(body.confidence < 0.6);
    assert.deepEqual(body.sources, []);
    assert.match(body.jiraTicketDraft.title, /問い合わせ/);
    assert.ok(body.jiraTicketDraft.labels.includes("knowledge-desk"));
  });
});
