import type {
  JiraTicketDraft,
  KnowledgeDeskQueryRequest,
  KnowledgeDeskResponse,
  OnyxQueryResult,
  SourceName,
  SourceReference,
} from "./types.ts";

const UNCERTAINTY_TERMS = [
  "不明",
  "確認が必要",
  "担当部門へ確認",
  "判断できません",
  "情報不足",
];
const SERVICE_TERMS = [
  "VPN",
  "Box",
  "SharePoint",
  "Jira",
  "Teams",
  "Salesforce",
];

export function normalizeKnowledgeDeskResponse(
  request: KnowledgeDeskQueryRequest,
  onyxResult: OnyxQueryResult
): KnowledgeDeskResponse {
  const rawSources = dedupeSources(
    onyxResult.results.map((result) => {
      const source: SourceReference = {
        source: result.source,
        title: result.title,
        url: result.url,
      };

      if (result.content.trim().length > 0) {
        source.snippet = result.content.trim();
      }

      if (Number.isFinite(result.score)) {
        source.score = result.score;
      }

      return source;
    })
  );
  const sources = filterRelevantSources(request.question, rawSources);

  const answer =
    sources.length > 0 && onyxResult.answer
      ? onyxResult.answer
      : [
          "現時点のナレッジでは、この問い合わせに回答するための十分な根拠が見つかりませんでした。",
          "情シス部門で詳細確認が必要です。",
        ].join("\n");

  const confidence = calculateConfidence(answer, sources);
  const escalationReason = buildEscalationReason(confidence, sources);
  const needsEscalation = escalationReason !== null;

  return {
    answer,
    sources,
    confidence,
    needsEscalation,
    escalationReason,
    jiraTicketDraft: needsEscalation
      ? buildJiraTicketDraft(request, escalationReason)
      : null,
    jiraTicket: null,
    jiraTicketUrl: null,
  };
}

function dedupeSources(sources: SourceReference[]): SourceReference[] {
  const seen = new Set<string>();

  return sources.filter((source) => {
    const key = `${source.source}:${source.title}:${source.url}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function filterRelevantSources(
  question: string,
  sources: SourceReference[]
): SourceReference[] {
  const queryTerms = extractQueryTerms(question);
  if (queryTerms.length === 0) {
    return sources;
  }

  const queryServiceTerms = SERVICE_TERMS.filter((term) =>
    normalizeText(question).includes(normalizeText(term))
  );

  return sources.filter((source) => {
    if (queryServiceTerms.length > 0) {
      return (
        sourceMatchesQueryTerms(source, queryServiceTerms) &&
        sourceHasEnoughMatchedTerms(source, queryTerms, queryServiceTerms)
      );
    }

    return sourceMatchesQueryTerms(source, queryTerms);
  });
}

function sourceHasEnoughMatchedTerms(
  source: SourceReference,
  queryTerms: string[],
  queryServiceTerms: string[]
): boolean {
  const matchedTerms = queryTerms.filter((term) =>
    sourceMatchesQueryTerms(source, [term])
  );
  const requiresSpecificContext = queryServiceTerms.some(
    (term) => normalizeText(term) === "box"
  );

  return !requiresSpecificContext || matchedTerms.length >= 2;
}

function sourceMatchesQueryTerms(
  source: SourceReference,
  queryTerms: string[]
): boolean {
  const sourceText = normalizeText(
    [source.title, source.snippet ?? ""].join(" ")
  );

  return queryTerms.some((term) => sourceText.includes(normalizeText(term)));
}

function extractQueryTerms(question: string): string[] {
  const normalizedQuestion = normalizeText(question);
  const domainTerms = [
    ...SERVICE_TERMS,
    "共有",
    "外部共有",
    "外部",
    "取引先",
    "フォルダ",
    "アクセス",
    "ログイン",
    "メール",
    "招待",
    "パスワード",
    "アカウント",
    "ネットワーク",
    "接続",
    "繋がらない",
    "つながらない",
  ].filter((term) => normalizedQuestion.includes(normalizeText(term)));

  const asciiTerms = normalizedQuestion.match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? [];

  return [...new Set([...domainTerms, ...asciiTerms])];
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

function calculateConfidence(answer: string, sources: SourceReference[]): number {
  if (sources.length === 0) {
    return 0.24;
  }

  const sourceTypes = new Set<SourceName>(sources.map((source) => source.source));
  let confidence = 0.32 + sourceTypes.size * 0.12;

  if (sourceTypes.has("Box") && sourceTypes.has("SharePoint")) {
    confidence += 0.12;
  }

  if (sourceTypes.has("Jira")) {
    confidence += 0.14;
  } else {
    confidence -= 0.14;
  }

  if (
    sourceTypes.has("Box") &&
    sourceTypes.has("SharePoint") &&
    sourceTypes.has("Jira")
  ) {
    confidence += 0.14;
  }

  const sourcesWithUsableSnippets = sources.filter(
    (source) => (source.snippet?.trim().length ?? 0) >= 40
  ).length;
  const snippetCoverage = sourcesWithUsableSnippets / sources.length;
  if (snippetCoverage >= 0.75) {
    confidence += 0.08;
  } else if (snippetCoverage < 0.5) {
    confidence -= 0.12;
  }

  const scoreValues = sources
    .map((source) => source.score)
    .filter((score): score is number => typeof score === "number");
  if (scoreValues.length > 0) {
    const averageScore =
      scoreValues.reduce((sum, score) => sum + score, 0) / scoreValues.length;
    if (averageScore >= 0.85) {
      confidence += 0.05;
    } else if (averageScore < 0.55) {
      confidence -= 0.08;
    }
  }

  const uncertaintyPenalty = UNCERTAINTY_TERMS.filter((term) =>
    answer.includes(term)
  ).length;
  confidence -= Math.min(uncertaintyPenalty * 0.08, 0.24);

  return roundToTwoDecimals(clamp(confidence, 0.15, 0.95));
}

function buildEscalationReason(
  confidence: number,
  sources: SourceReference[]
): string | null {
  if (confidence < 0.6) {
    if (sources.length === 0) {
      return "関連するBox、SharePoint、Jiraのナレッジが見つからないため、情シス部門で確認が必要です。";
    }

    const sourceTypes = new Set<SourceName>(sources.map((source) => source.source));
    if (!sourceTypes.has("Jira")) {
      return "Jiraの過去解決履歴が不足しており、誤案内の可能性があるため、情シス部門で確認が必要です。";
    }

    return "回答根拠が不足しており、誤案内の可能性があるため、情シス部門で確認が必要です。";
  }

  return null;
}

function buildJiraTicketDraft(
  request: KnowledgeDeskQueryRequest,
  escalationReason: string
): JiraTicketDraft {
  const isBoxExternalSharing = isLikelyBoxExternalSharing(request.question);
  const title = isBoxExternalSharing
    ? "Box外部共有に関する問い合わせ: 取引先がアクセスできない"
    : "社内問い合わせ: ナレッジ不足により要確認";
  const labels = isBoxExternalSharing
    ? ["box", "external-sharing", "knowledge-desk"]
    : ["knowledge-desk", "needs-triage"];
  const confirmationItems = isBoxExternalSharing
    ? [
        "- 対象BoxフォルダのURL",
        "- 招待先メールアドレス",
        "- 取引先ドメイン",
        "- フォルダの機密区分",
        "- 共有リンク利用有無",
      ]
    : [
        "- 事象の発生日時",
        "- 対象システムまたはサービス",
        "- 利用者の操作手順",
        "- 表示されたエラーメッセージ",
        "- 影響範囲と緊急度",
      ];

  return {
    title,
    description: [
      `問い合わせ元: ${request.user}`,
      `チャネル: ${request.channel}`,
      "",
      "問い合わせ内容:",
      request.question,
      "",
      "エスカレーション理由:",
      escalationReason,
      "",
      "確認観点:",
      ...confirmationItems,
    ].join("\n"),
    priority: "Medium",
    labels,
    assigneeTeam: "Corporate IT",
  };
}

function isLikelyBoxExternalSharing(question: string): boolean {
  const terms = ["Box", "box", "共有", "外部", "取引先", "フォルダ"];
  return terms.filter((term) => question.includes(term)).length >= 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}
