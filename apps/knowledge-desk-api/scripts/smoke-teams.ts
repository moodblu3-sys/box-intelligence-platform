import { createKnowledgeDeskApp } from "../src/server.ts";

const DEMO_QUESTION =
  "取引先にBoxフォルダを共有したいのですが、相手からアクセスできないと言われています。外部共有の条件と、確認すべき手順を教えてください。";

async function main() {
  const app = createKnowledgeDeskApp();
  const response = await app.fetch(
    new Request("http://localhost/api/knowledge-desk/teams/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channelId: "teams",
        from: {
          userPrincipalName: process.env.SMOKE_USER ?? "suzuki@nisshin-tech.example",
        },
        text: process.env.SMOKE_QUESTION ?? DEMO_QUESTION,
      }),
    })
  );

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(`Knowledge Desk Teams endpoint returned ${response.status}: ${rawBody}`);
  }

  const body = JSON.parse(rawBody) as {
    type: string;
    text: string;
    knowledgeDesk: {
      confidence: number;
      needsEscalation: boolean;
      sources: Array<{ source: string; title: string }>;
    };
  };

  if (body.type !== "message") {
    throw new Error(`Expected Teams message response, got ${body.type}.`);
  }

  console.log("Knowledge Desk Teams smoke succeeded.");
  console.log(`confidence=${body.knowledgeDesk.confidence}`);
  console.log(`needsEscalation=${body.knowledgeDesk.needsEscalation}`);
  console.log(
    `sources=${body.knowledgeDesk.sources
      .map((source) => `${source.source}:${source.title}`)
      .join(" | ")}`
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
