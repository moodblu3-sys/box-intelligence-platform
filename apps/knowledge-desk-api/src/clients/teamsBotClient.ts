import type {
  TeamsBotActivity,
  TeamsBotSuggestedAction,
} from "../teamsBotActivityAdapter.ts";

export interface TeamsBotClient {
  sendReply(input: TeamsBotReplyInput): Promise<TeamsBotReplyResult>;
}

export interface TeamsBotReplyInput {
  activity: TeamsBotActivity;
  text: string;
  suggestedActions?: TeamsBotSuggestedAction[];
}

export interface TeamsBotReplyResult {
  sent: boolean;
  status: number | null;
  error: string | null;
}

export class NoopTeamsBotClient implements TeamsBotClient {
  async sendReply(): Promise<TeamsBotReplyResult> {
    return {
      sent: false,
      status: null,
      error: null,
    };
  }
}

export interface BotFrameworkTeamsBotClientOptions {
  appId: string;
  appPassword: string;
  tenantId: string;
  fetchFn?: typeof fetch;
}

interface BotAccessTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export class BotFrameworkTeamsBotClient implements TeamsBotClient {
  private readonly appId: string;
  private readonly appPassword: string;
  private readonly tenantId: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: BotFrameworkTeamsBotClientOptions) {
    this.appId = options.appId;
    this.appPassword = options.appPassword;
    this.tenantId = options.tenantId;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async sendReply(input: TeamsBotReplyInput): Promise<TeamsBotReplyResult> {
    const serviceUrl = input.activity.serviceUrl?.replace(/\/+$/, "");
    const conversationId = input.activity.conversation?.id;
    const activityId = input.activity.id;

    if (!serviceUrl || !conversationId || !activityId) {
      return {
        sent: false,
        status: null,
        error:
          "Teams activity is missing serviceUrl, conversation.id, or activity.id.",
      };
    }

    const token = await this.getAccessToken();
    const response = await this.fetchFn(
      `${serviceUrl}/v3/conversations/${encodeURIComponent(
        conversationId
      )}/activities/${encodeURIComponent(activityId)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "message",
          from: input.activity.recipient ?? {
            id: this.appId,
            name: "Knot",
          },
          recipient: input.activity.from,
          conversation: input.activity.conversation,
          replyToId: activityId,
          text: input.text,
          suggestedActions: input.suggestedActions
            ? {
                actions: input.suggestedActions,
              }
            : undefined,
        }),
      }
    );

    if (!response.ok) {
      return {
        sent: false,
        status: response.status,
        error: await response.text(),
      };
    }

    return {
      sent: true,
      status: response.status,
      error: null,
    };
  }

  private async getAccessToken(): Promise<string> {
    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(
      this.tenantId
    )}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.appId,
      client_secret: this.appPassword,
      scope: "https://api.botframework.com/.default",
    });

    const response = await this.fetchFn(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const payload = (await response.json()) as BotAccessTokenResponse;

    if (!response.ok || !payload.access_token) {
      throw new Error(
        `Bot Framework token request failed: ${response.status} ${
          payload.error_description ?? payload.error ?? "unknown error"
        }`
      );
    }

    return payload.access_token;
  }
}

export function createTeamsBotClientFromEnv(): TeamsBotClient {
  const replyMode = (process.env.TEAMS_BOT_REPLY_MODE ?? "http").toLowerCase();

  if (replyMode !== "connector") {
    return new NoopTeamsBotClient();
  }

  return new BotFrameworkTeamsBotClient({
    appId: requiredEnv("MICROSOFT_APP_ID"),
    appPassword: requiredEnv("MICROSOFT_APP_PASSWORD"),
    tenantId: requiredEnv("MICROSOFT_APP_TENANT_ID"),
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required when TEAMS_BOT_REPLY_MODE=connector.`);
  }

  return value;
}
