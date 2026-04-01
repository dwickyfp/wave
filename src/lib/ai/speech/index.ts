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
    { id: "gpt-4o-realtime-preview", label: "GPT-4o Realtime" },
    { id: "gpt-4o-mini-realtime-preview", label: "GPT-4o Mini Realtime" },
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
