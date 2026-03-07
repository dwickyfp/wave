import type { UIMessage } from "ai";

export type AgentExternalTransport = "continue_chat" | "continue_autocomplete";

export type AgentExternalUsageKind = "chat_turn" | "autocomplete_request";

export type AgentExternalUsageStatus = "success" | "error" | "cancelled";

export type AgentDashboardSessionSource = "in_app" | "external_chat";

export type AgentDashboardTranscriptMode = "full" | "preview";

export type AgentUsageTimelinePoint = {
  date: string;
  requests: number;
  sessions?: number;
  totalTokens: number;
};

export type AgentInAppSessionSummary = {
  threadId: string;
  title: string;
  assistantMessages: number;
  totalTokens: number;
  lastMessageAt: string;
};

export type AgentExternalChatSessionSummary = {
  sessionId: string;
  firstUserPreview: string;
  summaryPreview: string | null;
  totalTurns: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  lastModelProvider: string | null;
  lastModelName: string | null;
  lastStatus: AgentExternalUsageStatus;
  createdAt: string;
  updatedAt: string;
};

export type AgentAutocompleteRequestSummary = {
  id: string;
  requestPreview: string | null;
  responsePreview: string | null;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  modelProvider: string | null;
  modelName: string | null;
  status: AgentExternalUsageStatus;
  createdAt: string;
};

export type AgentInAppUsageStats = {
  totalSessions: number;
  totalAssistantMessages: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  daily: AgentUsageTimelinePoint[];
  recentSessions: AgentInAppSessionSummary[];
};

export type AgentExternalChatUsageStats = {
  totalSessions: number;
  totalTurns: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  daily: AgentUsageTimelinePoint[];
  recentSessions: AgentExternalChatSessionSummary[];
};

export type AgentAutocompleteUsageStats = {
  totalRequests: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  daily: AgentUsageTimelinePoint[];
  recentRequests: AgentAutocompleteRequestSummary[];
};

export type AgentDashboardStats = {
  rangeDays: number;
  inApp: AgentInAppUsageStats;
  externalChat: AgentExternalChatUsageStats;
  autocomplete: AgentAutocompleteUsageStats;
};

export type AgentDashboardSessionDetail = {
  source: AgentDashboardSessionSource;
  sessionId: string;
  title: string;
  summary: string | null;
  transcriptMode: AgentDashboardTranscriptMode;
  totalTurns: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  status: AgentExternalUsageStatus | null;
  modelProvider: string | null;
  modelName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  messages: UIMessage[];
};
