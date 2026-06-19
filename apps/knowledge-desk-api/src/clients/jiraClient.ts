import type { JiraTicketDraft, JiraTicketResult } from "../types.ts";

export interface JiraClient {
  createIssue(input: JiraCreateIssueInput): Promise<JiraTicketResult>;
}

export interface JiraCreateIssueInput {
  draft: JiraTicketDraft;
  requester: string;
  question: string;
}

export class DryRunJiraClient implements JiraClient {
  async createIssue(): Promise<JiraTicketResult> {
    return {
      created: false,
      dryRun: true,
      key: null,
      url: null,
      error: null,
    };
  }
}

export interface AtlassianJiraClientOptions {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType: string;
  fetchFn?: typeof fetch;
}

interface JiraCreateIssueResponse {
  key?: string;
  self?: string;
}

export class AtlassianJiraClient implements JiraClient {
  private readonly baseUrl: string;
  private readonly email: string;
  private readonly apiToken: string;
  private readonly projectKey: string;
  private readonly issueType: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: AtlassianJiraClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.email = options.email;
    this.apiToken = options.apiToken;
    this.projectKey = options.projectKey;
    this.issueType = options.issueType;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async createIssue(input: JiraCreateIssueInput): Promise<JiraTicketResult> {
    const response = await this.fetchFn(`${this.baseUrl}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${this.email}:${this.apiToken}`
        ).toString("base64")}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          project: {
            key: this.projectKey,
          },
          issuetype: {
            name: this.issueType,
          },
          summary: input.draft.title,
          description: toAtlassianDocument([
            input.draft.description,
            "",
            `Requester: ${input.requester}`,
            `Original question: ${input.question}`,
            `Assignee team: ${input.draft.assigneeTeam}`,
          ]),
          labels: input.draft.labels,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        created: false,
        dryRun: false,
        key: null,
        url: null,
        error: `Jira issue creation failed: ${response.status} ${body}`,
      };
    }

    const body = (await response.json()) as JiraCreateIssueResponse;
    const key = body.key ?? null;

    return {
      created: key !== null,
      dryRun: false,
      key,
      url: issueUrl(this.baseUrl, key, body.self),
      error: null,
    };
  }
}

export function createJiraClientFromEnv(): JiraClient {
  const dryRun = (process.env.JIRA_DRY_RUN ?? "true").toLowerCase() !== "false";

  if (dryRun) {
    return new DryRunJiraClient();
  }

  const baseUrl = requiredEnv("JIRA_BASE_URL");
  const email = requiredEnv("JIRA_EMAIL");
  const apiToken = requiredEnv("JIRA_API_TOKEN");
  const projectKey = process.env.JIRA_PROJECT_KEY ?? "CIH";
  const issueType = process.env.JIRA_ISSUE_TYPE ?? "Task";

  return new AtlassianJiraClient({
    baseUrl,
    email,
    apiToken,
    projectKey,
    issueType,
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required when JIRA_DRY_RUN=false.`);
  }

  return value;
}

function toAtlassianDocument(textBlocks: string[]) {
  const content = textBlocks
    .join("\n")
    .split("\n")
    .map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    }));

  return {
    type: "doc",
    version: 1,
    content,
  };
}

function issueUrl(
  baseUrl: string,
  key: string | null | undefined,
  fallbackUrl?: string
): string | null {
  if (key) {
    return `${baseUrl}/browse/${key}`;
  }

  return fallbackUrl ?? null;
}
