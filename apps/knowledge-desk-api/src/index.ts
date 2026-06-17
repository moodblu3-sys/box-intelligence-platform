import { createServer, type IncomingMessage } from "node:http";
import { createKnowledgeDeskApp } from "./server.ts";

const port = Number(process.env.KNOWLEDGE_DESK_PORT ?? process.env.PORT ?? "8787");
const app = createKnowledgeDeskApp();

const server = createServer(async (incomingRequest, outgoingResponse) => {
  try {
    const request = await toWebRequest(incomingRequest, port);
    const response = await app.fetch(request);
    const responseBody = Buffer.from(await response.arrayBuffer());

    outgoingResponse.writeHead(
      response.status,
      Object.fromEntries(response.headers.entries())
    );
    outgoingResponse.end(responseBody);
  } catch (error) {
    console.error("Knowledge Desk HTTP server failed", error);
    outgoingResponse.writeHead(500, {
      "Content-Type": "application/json; charset=utf-8",
    });
    outgoingResponse.end(JSON.stringify({ error: "Internal server error" }));
  }
});

server.listen(port, () => {
  console.log(`Knowledge Desk API listening on http://localhost:${port}`);
});

async function toWebRequest(
  incomingRequest: IncomingMessage,
  portNumber: number
): Promise<Request> {
  const origin = `http://${incomingRequest.headers.host ?? `localhost:${portNumber}`}`;
  const url = new URL(incomingRequest.url ?? "/", origin);
  const method = incomingRequest.method ?? "GET";
  const headers = new Headers();

  for (const [key, value] of Object.entries(incomingRequest.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : await readRequestBody(incomingRequest);

  return new Request(url, {
    method,
    headers,
    body,
  });
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}
