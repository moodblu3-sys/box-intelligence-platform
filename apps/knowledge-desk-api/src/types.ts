export type KnowledgeDeskChannel = "teams" | "web" | "api";

export type SourceName = "Box" | "SharePoint" | "Jira";

export interface KnowledgeDeskQueryRequest {
  user: string;
  channel: KnowledgeDeskChannel | string;
  question: string;
}

export interface SourceReference {
  source: SourceName;
  title: string;
  url: string;
  snippet?: string;
  score?: number;
}

export interface JiraTicketDraft {
  title: string;
  description: string;
  priority: "Low" | "Medium" | "High";
  labels: string[];
  assigneeTeam: string;
}

export interface JiraTicketResult {
  created: boolean;
  dryRun: boolean;
  key: string | null;
  url: string | null;
  error: string | null;
}

export interface KnowledgeDeskResponse {
  answer: string;
  sources: SourceReference[];
  confidence: number;
  needsEscalation: boolean;
  escalationReason: string | null;
  jiraTicketDraft: JiraTicketDraft | null;
  jiraTicket: JiraTicketResult | null;
  jiraTicketUrl: string | null;
}

export interface OnyxQueryInput {
  user: string;
  channel: string;
  question: string;
  sources: SourceName[];
}

export interface OnyxSearchResult {
  source: SourceName;
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface OnyxQueryResult {
  answer: string | null;
  results: OnyxSearchResult[];
}
