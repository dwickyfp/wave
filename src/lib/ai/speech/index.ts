import { UIMessage } from "ai";
import type { UseChatHelpers } from "@ai-sdk/react";
import { ChatMention } from "app-types/chat";
import { AllowedMCPServer } from "app-types/mcp";
import { AppDefaultToolkit } from "lib/ai/tools";
import type { VoiceSessionMode } from "./open-ai/openai-realtime-event";

export type VoiceChatPhase =
  | "idle"
  | "connecting"
  | "ready"
  | "listening"
  | "thinking"
  | "tool-call"
  | "speaking"
  | "muted"
  | "error";

export type VoicePendingToolCall = {
  callId: string;
  toolName: string;
  startedAt: number;
  status: "pending" | "running" | "completed" | "failed";
};

export type VoiceTimelineEntry = {
  at: number;
  type: string;
  details?: Record<string, unknown>;
};

export interface VoiceChatSession {
  isActive: boolean;
  isListening: boolean;
  isUserSpeaking: boolean;
  isAssistantSpeaking: boolean;
  isLoading: boolean;
  isProcessingTurn: boolean;
  phase: VoiceChatPhase;
  transport: "webrtc" | "websocket" | null;
  activeResponseId: string | null;
  lastAssistantItemId: string | null;
  pendingToolCalls: VoicePendingToolCall[];
  timeline: VoiceTimelineEntry[];
  liveInputTranscript: string;
  messages: UIMessage[];
  addToolResult?: UseChatHelpers<UIMessage>["addToolResult"];
  error: Error | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
}

export type VoiceChatOptions = {
  mentions?: ChatMention[];
  allowedMcpServers?: Record<string, AllowedMCPServer>;
  allowedAppDefaultToolkit?: AppDefaultToolkit[];
  agentId?: string;
  threadId?: string;
  transcriptionLanguage?: string;
  voice?: string;
  voiceMode?: VoiceSessionMode;
};

export type VoiceChatHook = (props?: {
  [key: string]: any;
}) => VoiceChatSession;
