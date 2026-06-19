export type MessageIntent =
  | "knowledge_question"
  | "resolution_resolved"
  | "resolution_unresolved"
  | "ticket_request"
  | "small_talk"
  | "conversation_closing"
  | "unclear";

export interface MessageIntentInput {
  text: string;
  actionText: string;
  channel: string;
  hasPendingAnswer: boolean;
  previousQuestion: string | null;
}

export interface MessageIntentResult {
  intent: MessageIntent;
  confidence: number;
  replyText: string | null;
  reason: string | null;
}

export interface MessageIntentClassifier {
  classify(input: MessageIntentInput): Promise<MessageIntentResult>;
}

type FetchLike = typeof fetch;

interface OnyxMessageIntentClassifierOptions {
  baseUrl: string;
  apiKey: string;
  fetchFn?: FetchLike;
  timeoutMs?: number;
  fallback: MessageIntentClassifier;
}

interface OnyxChatResponse {
  answer?: unknown;
  answer_citationless?: unknown;
  error_msg?: unknown;
}

const DEFAULT_CONFIDENCE = 0.9;

export class RuleBasedMessageIntentClassifier implements MessageIntentClassifier {
  async classify(input: MessageIntentInput): Promise<MessageIntentResult> {
    return classifyWithRules(input);
  }
}

export class OnyxMessageIntentClassifier implements MessageIntentClassifier {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;
  private readonly fallback: MessageIntentClassifier;

  constructor(options: OnyxMessageIntentClassifierOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.fallback = options.fallback;
  }

  async classify(input: MessageIntentInput): Promise<MessageIntentResult> {
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
            message: buildIntentPrompt(input),
            stream: false,
            include_citations: false,
            origin: "api",
            chat_session_info: {
              persona_id: 0,
              description: "Knowledge Desk intent classification",
            },
          }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        throw new Error(`Onyx intent classification failed: ${response.status}`);
      }

      const payload = (await response.json()) as OnyxChatResponse;
      if (typeof payload.error_msg === "string" && payload.error_msg.length > 0) {
        throw new Error(`Onyx intent classification error: ${payload.error_msg}`);
      }

      return normalizeIntentResult(
        parseIntentJson(asString(payload.answer_citationless) ?? asString(payload.answer))
      );
    } catch (error) {
      console.warn("AI intent classification fell back to local rules", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.fallback.classify(input);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createMessageIntentClassifierFromEnv(): MessageIntentClassifier {
  const fallback = new RuleBasedMessageIntentClassifier();
  const mode = (process.env.KNOWLEDGE_DESK_INTENT_MODE ?? "hybrid").toLowerCase();

  if (mode === "rule") {
    return fallback;
  }

  const baseUrl = process.env.KNOWLEDGE_DESK_INTENT_ONYX_BASE_URL ?? process.env.ONYX_BASE_URL;
  const apiKey = process.env.KNOWLEDGE_DESK_INTENT_ONYX_API_KEY ?? process.env.ONYX_API_KEY;

  if ((mode === "onyx" || mode === "hybrid") && baseUrl && apiKey) {
    return new OnyxMessageIntentClassifier({
      baseUrl,
      apiKey,
      fallback,
      timeoutMs: Number(process.env.KNOWLEDGE_DESK_INTENT_TIMEOUT_MS ?? "8000"),
    });
  }

  if (mode === "onyx") {
    console.warn(
      "KNOWLEDGE_DESK_INTENT_MODE=onyx requires ONYX_BASE_URL and ONYX_API_KEY. Falling back to local rules."
    );
  }

  return fallback;
}

export function normalizeActionText(text: string): string {
  return text
    .replace(/<at>.*?<\/at>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractActivityValueText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  return [record.action, record.value, record.text, record.command]
    .filter((item): item is string => typeof item === "string")
    .join(" ");
}

function classifyWithRules(input: MessageIntentInput): MessageIntentResult {
  const actionText = `${input.text} ${input.actionText}`.trim().toLowerCase();

  if (
    actionText.includes("解決しません") ||
    actionText.includes("解決していません") ||
    actionText.includes("未解決")
  ) {
    return result("resolution_unresolved", "利用者が未解決であることを明示している。");
  }

  if (actionText.includes("解決しました") || actionText.includes("解決済み")) {
    return result("resolution_resolved", "利用者が解決済みであることを明示している。");
  }

  if (actionText.includes("起票") || actionText.includes("チケット")) {
    return result("ticket_request", "利用者がチケット起票を求めている。");
  }

  const lowerText = input.text.toLowerCase();
  if (!lowerText || lowerText.length > 40 || /[?？]/.test(lowerText)) {
    return result("knowledge_question", "質問または確認依頼として扱う。", null, 0.7);
  }

  const gratitudePhrases = [
    "ありがとう",
    "ありがとうございます",
    "助かった",
    "助かりました",
    "thanks",
    "thank you",
    "thx",
  ];
  const closingPhrases = [
    "また聞",
    "また相談",
    "また連絡",
    "後で聞",
    "あとで聞",
    "いったん大丈夫",
    "一旦大丈夫",
    "大丈夫です",
    "またお願い",
    "またよろしく",
  ];
  const acknowledgementPhrases = [
    "了解",
    "承知",
    "わかった",
    "分かった",
    "わかりました",
    "ok",
    "okay",
  ];

  if (gratitudePhrases.some((phrase) => lowerText.includes(phrase))) {
    return result(
      "small_talk",
      "お礼の短文。",
      "どういたしまして。必要になったらまた聞いてください。"
    );
  }

  if (closingPhrases.some((phrase) => lowerText.includes(phrase))) {
    return result("conversation_closing", "会話を閉じる短文。", "はい。いつでも聞いてください。");
  }

  if (acknowledgementPhrases.some((phrase) => lowerText.includes(phrase))) {
    return result(
      "small_talk",
      "了承の短文。",
      "承知しました。必要になったらまた聞いてください。"
    );
  }

  if (lowerText.length < 8) {
    return result(
      "unclear",
      "問い合わせとしては短く、意図が不足している。",
      "確認したい内容をもう少し具体的に教えてください。"
    );
  }

  return result("knowledge_question", "問い合わせとして扱う。", null, 0.65);
}

function buildIntentPrompt(input: MessageIntentInput): string {
  return [
    "あなたは社内問い合わせAIの入力意図を分類する判定器です。",
    "ユーザーの発話が、社内ナレッジ検索すべき質問か、会話終了か、雑談か、解決確認か、チケット起票依頼かを判断してください。",
    "必ずJSONだけを返してください。Markdownや説明文は不要です。",
    "",
    "分類ラベル:",
    "- knowledge_question: Box、SharePoint、Jiraなどの社内情報を検索して回答すべき問い合わせ",
    "- resolution_resolved: 直前の回答で解決したというフィードバック",
    "- resolution_unresolved: 直前の回答では解決しない、まだ困っているというフィードバック",
    "- ticket_request: Jiraなどへの問い合わせ起票を明示的に求めている",
    "- small_talk: お礼、挨拶、相づち",
    "- conversation_closing: また聞く、あとで確認する、いったん大丈夫など会話を閉じる発話",
    "- unclear: 意図が短すぎる、または判断に必要な情報がない",
    "",
    "判断ルール:",
    "- 質問ではない短い会話文を knowledge_question にしない。",
    "- 「また聞くね」「あとで確認します」は conversation_closing。",
    "- 「ありがとう」は small_talk。",
    "- 「うまくいきません」「まだできません」は、直前回答がある場合 resolution_unresolved。",
    "- ボタン操作や明示的な「解決しました」「解決しません」は優先する。",
    "",
    "出力JSON形式:",
    '{"intent":"knowledge_question","confidence":0.0,"replyText":null,"reason":"短い理由"}',
    "",
    `channel: ${input.channel}`,
    `hasPendingAnswer: ${input.hasPendingAnswer}`,
    `previousQuestion: ${input.previousQuestion ?? ""}`,
    `actionText: ${input.actionText}`,
    `userText: ${input.text}`,
  ].join("\n");
}

function parseIntentJson(text: string | null): unknown {
  if (!text) {
    throw new Error("Intent classifier returned an empty answer.");
  }

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Intent classifier did not return JSON.");
  }

  return JSON.parse(match[0]);
}

function normalizeIntentResult(payload: unknown): MessageIntentResult {
  if (!payload || typeof payload !== "object") {
    throw new Error("Intent classifier JSON must be an object.");
  }

  const record = payload as Record<string, unknown>;
  const intent = asMessageIntent(record.intent);
  const confidence =
    typeof record.confidence === "number"
      ? Math.max(0, Math.min(1, record.confidence))
      : 0.5;
  const replyText =
    typeof record.replyText === "string" && record.replyText.trim().length > 0
      ? record.replyText.trim()
      : null;
  const reason =
    typeof record.reason === "string" && record.reason.trim().length > 0
      ? record.reason.trim()
      : null;

  return {
    intent,
    confidence,
    replyText,
    reason,
  };
}

function asMessageIntent(value: unknown): MessageIntent {
  const intents: MessageIntent[] = [
    "knowledge_question",
    "resolution_resolved",
    "resolution_unresolved",
    "ticket_request",
    "small_talk",
    "conversation_closing",
    "unclear",
  ];

  if (typeof value === "string" && intents.includes(value as MessageIntent)) {
    return value as MessageIntent;
  }

  throw new Error(`Unsupported message intent: ${String(value)}`);
}

function result(
  intent: MessageIntent,
  reason: string,
  replyText: string | null = null,
  confidence = DEFAULT_CONFIDENCE
): MessageIntentResult {
  return {
    intent,
    confidence,
    replyText,
    reason,
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
