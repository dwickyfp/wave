import { UIMessage } from "ai";
import type { UseChatHelpers } from "@ai-sdk/react";
import { ChatMention } from "app-types/chat";
import { AllowedMCPServer } from "app-types/mcp";
import { AppDefaultToolkit } from "lib/ai/tools";

export interface VoiceChatSession {
  isActive: boolean;
  isListening: boolean;
  isUserSpeaking: boolean;
  isAssistantSpeaking: boolean;
  isLoading: boolean;
  isProcessingTurn: boolean;
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
};

export type VoiceChatHook = (props?: {
  [key: string]: any;
}) => VoiceChatSession;
