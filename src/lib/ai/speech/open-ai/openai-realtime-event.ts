export const OPENAI_REALTIME_URL =
  "https://api.openai.com/v1/realtime/sessions";

export type VoiceSessionMode = "legacy" | "realtime_native";

export type VoiceToolPolicy = {
  fillerDelayMs: number;
  progressDelayMs: number;
  longProgressDelayMs: number;
  allowBargeIn: boolean;
  preferAudioReplies: boolean;
};

export type VoiceToolFillerKey =
  | "search"
  | "lookup"
  | "workflow"
  | "knowledge"
  | "code"
  | "visualization"
  | "tool";

export type VoiceRealtimeTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  voiceSafe: boolean;
  spokenLabel: string;
  fillerKey: VoiceToolFillerKey;
  maxSpokenSummaryChars: number;
  preferSilentExecution: boolean;
  source: string;
};

export type OpenAIRealtimeSession = {
  id: string;
  object: string;
  model: string;
  modalities: string[];
  instructions: string;
  voice: string;
  input_audio_format: string;
  output_audio_format: string;
  input_audio_transcription: {
    model: string;
  };
  tools: any[];
  tool_choice: string;
  temperature: number;
  max_response_output_tokens: number;
  client_secret: {
    value: string;
    expires_at: number;
  };
  voiceMode?: VoiceSessionMode;
  voiceTools?: VoiceRealtimeTool[];
  voicePolicy?: VoiceToolPolicy;
  pendingSessionUpdate?: Record<string, unknown>;
  websocketSessionUpdate?: Record<string, unknown>;
  realtimeEndpointUrl?: string;
  websocketEndpointUrl?: string;
  proxySdpUrl?: string;
  sdpAuthHeader?: string;
  [key: string]: any;
};

export type OpenAIRealtimeClientEvent =
  | {
      type: "session.update";
      session: Partial<OpenAIRealtimeSession>;
    }
  | {
      type: "response.cancel";
    }
  | {
      type: "output_audio_buffer.clear";
    }
  | {
      type: "response.create";
      response?: Record<string, unknown>;
    }
  | {
      type: "conversation.item.create";
      previous_item_id?: string;
      item:
        | {
            id?: string;
            type: "message";
            role: "user" | "assistant" | "system";
            content: Array<
              | {
                  type: "input_text" | "text";
                  text: string;
                }
              | {
                  type: "input_audio";
                  audio: string;
                }
            >;
          }
        | {
            id?: string;
            type: "function_call_output";
            call_id: string;
            output: string;
          };
    }
  | {
      type: "conversation.item.truncate";
      item_id: string;
      content_index: number;
      audio_end_ms: number;
    };

export type OpenAIRealtimeServerEvent =
  | {
      type: "response.created";
      event_id: string;
      response: {
        id: string;
        status?: string;
        metadata?: Record<string, unknown>;
      };
    }
  | {
      type:
        | "input_audio_buffer.speech_started"
        | "input_audio_buffer.speech_stopped"
        | "input_audio_buffer.committed"
        | "output_audio_buffer.started"
        | "output_audio_buffer.stopped";
      event_id: string;
      item_id: string;
    }
  | {
      type: "conversation.item.input_audio_transcription.completed";
      event_id: string;
      item_id: string;
      content_index: number;
      transcript?: string;
    }
  | {
      type: "conversation.item.input_audio_transcription.delta";
      event_id: string;
      item_id: string;
      content_index: number;
      delta: string;
    }
  | {
      type:
        | "response.audio.delta"
        | "response.output_audio.delta"
        | "response.audio_transcript.delta"
        | "response.output_audio_transcript.delta"
        | "response.output_text.delta";
      event_id: string;
      response_id: string;
      item_id: string;
      output_index: number;
      content_index: number;
      delta: string;
    }
  | {
      type:
        | "response.audio_transcript.done"
        | "response.output_audio_transcript.done"
        | "response.output_text.done";
      event_id: string;
      response_id: string;
      item_id: string;
      output_index: number;
      content_index: number;
      transcript: string;
    }
  | {
      type: "response.audio.done" | "response.output_audio.done";
      event_id: string;
      response_id: string;
      item_id: string;
      output_index: number;
      content_index: number;
    }
  | {
      type: "response.function_call_arguments.done";
      event_id: string;
      response_id: string;
      item_id: string;
      output_index: number;
      name: string;
      call_id: string;
      arguments: string;
    }
  | {
      type: "response.mcp_call_arguments.done";
      event_id: string;
      response_id: string;
      item_id: string;
      output_index: number;
      name: string;
      call_id: string;
      arguments: string;
    }
  | {
      type: "response.output_item.done";
      event_id: string;
      response_id: string;
      output_index: number;
      item: {
        id: string;
        type: string;
        role?: string;
        call_id?: string;
        name?: string;
        arguments?: string;
        status?: string;
        output?: string;
        content?: Array<{
          type: string;
          text?: string;
          transcript?: string;
        }>;
      };
    }
  | {
      type: "conversation.item.created";
      event_id: string;
      previous_item_id?: string | null;
      item: {
        id: string;
        type: string;
        role?: string;
        content?: Array<{
          type: string;
          text?: string;
          transcript?: string;
        }>;
      };
    }
  | {
      type: "conversation.item.truncated";
      event_id: string;
      item_id: string;
      content_index: number;
      audio_end_ms: number;
    }
  | {
      type: "response.done";
      event_id: string;
      response: {
        id?: string;
        metadata?: Record<string, unknown>;
      };
    }
  | {
      type: "error" | "invalid_request_error";
      error: {
        message: string;
      };
    }
  | {
      type: "session.error";
      error: {
        message: string;
      };
    };
