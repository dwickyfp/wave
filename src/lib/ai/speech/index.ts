import { UIMessage } from "ai";
import { ChatMention } from "app-types/chat";

export type UIMessageWithCompleted = UIMessage & { completed: boolean };

export type VoiceProvider = "openai" | "azure";

export const VOICE_CHAT_MODELS: Record<
  VoiceProvider,
  { id: string; label: string }[]
> = {
  openai: [
    { id: "gpt-4o-realtime-preview", label: "GPT-4o Realtime" },
    { id: "gpt-4o-mini-realtime-preview", label: "GPT-4o Mini Realtime" },
  ],
  azure: [
    // GA models — use /openai/v1/realtime/client_secrets endpoint
    { id: "gpt-realtime-1.5-2026-02-23", label: "GPT Realtime 1.5" },
    { id: "gpt-realtime", label: "GPT Realtime" },
    { id: "gpt-realtime-mini", label: "GPT Realtime Mini" },
    {
      id: "gpt-realtime-mini-2025-12-15",
      label: "GPT Realtime Mini (Dec 2025)",
    },
    // Preview models — use legacy /openai/realtime/sessions endpoint
    { id: "gpt-4o-realtime-preview", label: "GPT-4o Realtime (Preview)" },
    {
      id: "gpt-4o-mini-realtime-preview",
      label: "GPT-4o Mini Realtime (Preview)",
    },
  ],
};

export interface VoiceChatSession {
  isActive: boolean;
  isListening: boolean;
  isUserSpeaking: boolean;
  isAssistantSpeaking: boolean;
  isLoading: boolean;
  messages: UIMessageWithCompleted[];
  error: Error | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
}

export type VoiceChatOptions = {
  toolMentions?: ChatMention[];
  agentId?: string;
  provider?: VoiceProvider;
  model?: string;
  voice?: string;
};

export type VoiceChatHook = (props?: {
  [key: string]: any;
}) => VoiceChatSession;

export const DEFAULT_VOICE_TOOLS = [
  {
    type: "function",
    name: "changeBrowserTheme",
    description: "Change the browser theme",
    parameters: {
      type: "object",
      properties: {
        theme: {
          type: "string",
          enum: ["light", "dark"],
        },
      },
      required: ["theme"],
    },
  },
  {
    type: "function",
    name: "endConversation",
    description:
      "End the current voice conversation, similar to hanging up a call. This tool should be invoked when the user clearly expresses a desire to finish, exit, or end the dialogue.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];
