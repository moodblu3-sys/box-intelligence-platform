import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RealOnyxClient } from "../src/clients/realOnyxClient.ts";
import { normalizeKnowledgeDeskResponse } from "../src/normalizer.ts";
import { createKnowledgeDeskApp } from "../src/server.ts";
import type { KnowledgeDeskQueryRequest } from "../src/types.ts";

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
    assert.ok(
      body.sources.every(
        (source: { snippet?: string; score?: number }) =>
          typeof source.snippet === "string" &&
          source.snippet.length >= 40 &&
          typeof source.score === "number"
      )
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

  test("normalizer returns source snippets and scores", () => {
    const request: KnowledgeDeskQueryRequest = {
      user: "suzuki@nisshin-tech.example",
      channel: "teams",
      question: DEMO_QUESTION,
    };

    const response = normalizeKnowledgeDeskResponse(request, {
      answer: "Box、SharePoint、Jiraの根拠を踏まえて回答します。",
      results: [
        {
          source: "Box",
          title: "Box外部共有運用ルール",
          url: "box://policies/external-sharing",
          content:
            "外部共有では、フォルダの機密区分、招待先メールアドレス、取引先ドメイン許可を確認します。",
          score: 0.91,
        },
      ],
    });

    assert.equal(response.sources.length, 1);
    assert.equal(response.sources[0]?.snippet?.includes("外部共有"), true);
    assert.equal(response.sources[0]?.score, 0.91);
  });

  test("RealOnyxClient maps Onyx chat documents to Knowledge Desk results", async () => {
    let capturedRequest: { url: string; body: Record<string, unknown> } | null = null;
    const fetchFn = async (
      input: string | URL | Request,
      init?: RequestInit
    ): Promise<Response> => {
      capturedRequest = {
        url: input.toString(),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      };

      return new Response(
        JSON.stringify({
          answer: "Box外部共有は、機密区分、ドメイン許可、招待メールを確認します。",
          top_documents: [
            {
              document_id: "box:file:1",
              semantic_identifier: "Box外部共有運用ルール",
              link: "https://app.box.com/file/1",
              blurb: "Boxの外部共有では機密区分と外部コラボレーター申請を確認します。",
              source_type: "box",
              score: 0.93,
              match_highlights: [
                "<hi>Box</hi>の外部共有では機密区分と取引先ドメイン許可を確認します。",
              ],
              metadata: {},
            },
          ],
          tool_calls: [
            {
              tool_name: "Search",
              search_docs: [
                {
                  document_id: "jira:BOX-1423",
                  semantic_identifier: "BOX-1423 取引先ドメイン未登録",
                  link: "https://example.atlassian.net/browse/BOX-1423",
                  blurb:
                    "取引先ドメインが未登録で外部ユーザーがBoxへアクセスできなかった事例。",
                  source_type: "jira",
                  score: 0.88,
                  match_highlights: [],
                  metadata: {},
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    };
    const client = new RealOnyxClient({
      baseUrl: "http://localhost:3100/",
      apiKey: "test-token",
      fetchFn,
    });

    const result = await client.query({
      user: "suzuki@nisshin-tech.example",
      channel: "teams",
      question: DEMO_QUESTION,
      sources: ["Box", "SharePoint", "Jira"],
    });

    assert.equal(
      capturedRequest?.url,
      "http://localhost:3100/api/chat/send-chat-message"
    );
    assert.deepEqual(
      (
        capturedRequest?.body.internal_search_filters as {
          source_type: string[];
        }
      ).source_type,
      ["box", "sharepoint", "jira"]
    );
    assert.match(result.answer ?? "", /機密区分/);
    assert.deepEqual(
      result.results.map((source) => source.source),
      ["Box", "Jira"]
    );
    assert.equal(result.results[0]?.content.includes("<hi>"), false);
    assert.equal(result.results[0]?.score, 0.93);
  });
});
