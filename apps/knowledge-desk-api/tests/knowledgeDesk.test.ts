import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AtlassianJiraClient } from "../src/clients/jiraClient.ts";
import { RealOnyxClient } from "../src/clients/realOnyxClient.ts";
import { BotFrameworkTeamsBotClient } from "../src/clients/teamsBotClient.ts";
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
    assert.equal(body.jiraTicket.created, false);
    assert.equal(body.jiraTicket.dryRun, true);
    assert.equal(body.jiraTicketUrl, null);
  });

  test("creates a Jira issue through the configured Jira client on escalation", async () => {
    const app = createKnowledgeDeskApp({
      jiraClient: {
        async createIssue(input) {
          assert.match(input.draft.title, /問い合わせ/);
          assert.equal(input.requester, "suzuki@nisshin-tech.example");

          return {
            created: true,
            dryRun: false,
            key: "CIH-123",
            url: "https://moodblu3.atlassian.net/browse/CIH-123",
            error: null,
          };
        },
      },
    });
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
    assert.equal(body.jiraTicket.created, true);
    assert.equal(body.jiraTicket.key, "CIH-123");
    assert.equal(
      body.jiraTicketUrl,
      "https://moodblu3.atlassian.net/browse/CIH-123"
    );
  });

  test("AtlassianJiraClient posts an issue to Jira Cloud", async () => {
    let capturedRequest: { url: string; body: Record<string, unknown> } | null =
      null;
    const fetchFn = async (
      input: string | URL | Request,
      init?: RequestInit
    ): Promise<Response> => {
      capturedRequest = {
        url: input.toString(),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      };

      return new Response(JSON.stringify({ key: "CIH-456" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new AtlassianJiraClient({
      baseUrl: "https://moodblu3.atlassian.net/",
      email: "moodblu3@gmail.com",
      apiToken: "test-token",
      projectKey: "CIH",
      issueType: "Task",
      fetchFn,
    });

    const result = await client.createIssue({
      requester: "suzuki@nisshin-tech.example",
      question: "解決できないので起票してください。",
      draft: {
        title: "社内問い合わせ: ナレッジ不足により要確認",
        description: "問い合わせ内容です。",
        priority: "Medium",
        labels: ["knowledge-desk", "needs-triage"],
        assigneeTeam: "Corporate IT",
      },
    });

    assert.equal(
      capturedRequest?.url,
      "https://moodblu3.atlassian.net/rest/api/3/issue"
    );
    const fields = capturedRequest?.body.fields as {
      project: { key: string };
      issuetype: { name: string };
      labels: string[];
    };
    assert.equal(fields.project.key, "CIH");
    assert.equal(fields.issuetype.name, "Task");
    assert.deepEqual(fields.labels, ["knowledge-desk", "needs-triage"]);
    assert.equal(result.created, true);
    assert.equal(result.url, "https://moodblu3.atlassian.net/browse/CIH-456");
  });

  test("accepts a Teams message activity and returns a Teams message response", async () => {
    const app = createKnowledgeDeskApp();
    const response = await app.fetch(
      new Request("http://localhost/api/knowledge-desk/teams/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: "teams",
          from: {
            userPrincipalName: "suzuki@nisshin-tech.example",
          },
          text: DEMO_QUESTION,
        }),
      })
    );

    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.type, "message");
    assert.match(body.text, /参照元/);
    assert.equal(body.knowledgeDesk.needsEscalation, false);
    assert.equal(body.knowledgeDesk.sources.length, 3);
  });

  test("accepts a Teams Bot Framework activity and sends a reply", async () => {
    let capturedReply: string | null = null;
    let capturedActions: unknown[] | undefined;
    const app = createKnowledgeDeskApp({
      teamsBotClient: {
        async sendReply(input) {
          capturedReply = input.text;
          capturedActions = input.suggestedActions;

          return {
            sent: true,
            status: 201,
            error: null,
          };
        },
      },
    });
    const response = await app.fetch(
      new Request("http://localhost/api/knowledge-desk/teams/bot/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "message",
          id: "activity-1",
          serviceUrl: "https://smba.trafficmanager.net/jp/",
          channelId: "msteams",
          conversation: {
            id: "conversation-1",
          },
          from: {
            aadObjectId: "user-object-id",
            name: "鈴木",
          },
          text: `<at>Knot</at> ${DEMO_QUESTION}`,
        }),
      })
    );

    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.type, "message");
    assert.equal(body.delivery.sent, true);
    assert.match(capturedReply ?? "", /Box外部共有の確認手順/);
    assert.match(capturedReply ?? "", /参照元/);
    assert.match(capturedReply ?? "", /この回答で解決しましたか/);
    assert.doesNotMatch(capturedReply ?? "", /\|/);
    assert.doesNotMatch(capturedReply ?? "", /✅|⚠️|🚨/);
    assert.equal(capturedActions?.length, 2);
    assert.equal(body.knowledgeDesk.needsEscalation, false);
    assert.equal(body.knowledgeDesk.sources.length, 3);
  });

  test("creates a Jira issue when a Teams Bot user says unresolved", async () => {
    const replies: string[] = [];
    let capturedRequester: string | null = null;
    const app = createKnowledgeDeskApp({
      jiraClient: {
        async createIssue(input) {
          capturedRequester = input.requester;
          assert.match(input.draft.title, /Teamsで未解決/);
          assert.ok(input.draft.labels.includes("teams-unresolved"));

          return {
            created: true,
            dryRun: false,
            key: "CIH-789",
            url: "https://moodblu3.atlassian.net/browse/CIH-789",
            error: null,
          };
        },
      },
      teamsBotClient: {
        async sendReply(input) {
          replies.push(input.text);

          return {
            sent: true,
            status: 201,
            error: null,
          };
        },
      },
    });
    const baseActivity = {
      type: "message",
      serviceUrl: "https://smba.trafficmanager.net/jp/",
      channelId: "msteams",
      conversation: {
        id: "conversation-unresolved",
      },
      from: {
        aadObjectId: "user-object-id",
        name: "鈴木",
      },
    };

    await app.fetch(
      new Request("http://localhost/api/knowledge-desk/teams/bot/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...baseActivity,
          id: "activity-question",
          text: DEMO_QUESTION,
        }),
      })
    );
    const response = await app.fetch(
      new Request("http://localhost/api/knowledge-desk/teams/bot/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...baseActivity,
          id: "activity-unresolved",
          text: "解決しません",
        }),
      })
    );

    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(capturedRequester, "user-object-id");
    assert.equal(body.jiraTicket.key, "CIH-789");
    assert.match(replies.at(-1) ?? "", /Jiraに起票しました/);
    assert.match(replies.at(-1) ?? "", /CIH-789/);
  });

  test("acknowledges Teams Bot activity immediately in connector reply mode", async () => {
    const previousReplyMode = process.env.TEAMS_BOT_REPLY_MODE;
    process.env.TEAMS_BOT_REPLY_MODE = "connector";
    let resolveDelivered: () => void = () => {};
    const delivered = new Promise<void>((resolve) => {
      resolveDelivered = resolve;
    });
    const app = createKnowledgeDeskApp({
      teamsBotClient: {
        async sendReply() {
          resolveDelivered();

          return {
            sent: true,
            status: 201,
            error: null,
          };
        },
      },
    });

    try {
      const response = await app.fetch(
        new Request("http://localhost/api/knowledge-desk/teams/bot/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "message",
            id: "activity-async",
            serviceUrl: "https://smba.trafficmanager.net/jp/",
            channelId: "msteams",
            conversation: {
              id: "conversation-async",
            },
            from: {
              aadObjectId: "user-object-id",
              name: "鈴木",
            },
            text: DEMO_QUESTION,
          }),
        })
      );

      assert.equal(response.status, 200);
      const body = await response.json();

      assert.equal(body.status, "accepted");
      assert.equal(body.delivery, "async");
      await delivered;
    } finally {
      if (previousReplyMode === undefined) {
        delete process.env.TEAMS_BOT_REPLY_MODE;
      } else {
        process.env.TEAMS_BOT_REPLY_MODE = previousReplyMode;
      }
    }
  });

  test("BotFrameworkTeamsBotClient posts a reply through the Bot Connector API", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const fetchFn = async (
      input: string | URL | Request,
      init?: RequestInit
    ): Promise<Response> => {
      requests.push({
        url: input.toString(),
        body: init?.body?.toString() ?? "",
      });

      if (input.toString().includes("/oauth2/v2.0/token")) {
        return new Response(JSON.stringify({ access_token: "bot-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ id: "reply-1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new BotFrameworkTeamsBotClient({
      appId: "app-id",
      appPassword: "app-password",
      tenantId: "tenant-id",
      fetchFn,
    });

    const result = await client.sendReply({
      activity: {
        id: "activity-1",
        serviceUrl: "https://smba.trafficmanager.net/jp/",
        from: {
          id: "user-id",
          name: "鈴木",
        },
        recipient: {
          id: "bot-id",
          name: "Knot",
        },
        conversation: {
          id: "conversation-1",
        },
      },
      text: "回答本文",
    });

    assert.equal(result.sent, true);
    assert.equal(
      requests[0]?.url,
      "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token"
    );
    assert.equal(
      requests[1]?.url,
      "https://smba.trafficmanager.net/jp/v3/conversations/conversation-1/activities/activity-1"
    );
    const replyBody = JSON.parse(requests[1]?.body ?? "{}") as {
      from?: { id?: string };
      recipient?: { id?: string };
      replyToId?: string;
      text?: string;
    };
    assert.equal(replyBody.from?.id, "bot-id");
    assert.equal(replyBody.recipient?.id, "user-id");
    assert.equal(replyBody.replyToId, "activity-1");
    assert.equal(replyBody.text, "回答本文");
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
