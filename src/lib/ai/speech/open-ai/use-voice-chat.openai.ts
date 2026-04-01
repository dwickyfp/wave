"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  DEFAULT_VOICE_TOOLS,
  UIMessageWithCompleted,
  VoiceChatOptions,
  VoiceChatSession,
} from "..";
import { generateUUID } from "lib/utils";
import { TextPart, ToolUIPart } from "ai";
import {
  OpenAIRealtimeServerEvent,
  OpenAIRealtimeSession,
} from "./openai-realtime-event";

import { useTheme } from "next-themes";
import { extractMCPToolId } from "lib/ai/mcp/mcp-tool-id";
import { callMcpToolByServerNameAction } from "@/app/api/mcp/actions";
import { appStore } from "@/app/store";

export const OPENAI_VOICE = {
  Alloy: "alloy",
  Ballad: "ballad",
  Sage: "sage",
  Shimmer: "shimmer",
  Verse: "verse",
  Echo: "echo",
  Coral: "coral",
  Ash: "ash",
};

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  {
    urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
  },
];

function getVoiceIceServers(): RTCIceServer[] {
  const configuredJson = process.env.NEXT_PUBLIC_VOICE_ICE_SERVERS_JSON?.trim();
  if (configuredJson) {
    try {
      const parsed = JSON.parse(configuredJson);
      if (Array.isArray(parsed)) {
        return parsed as RTCIceServer[];
      }
    } catch (error) {
      console.error(
        "voice rtc invalid NEXT_PUBLIC_VOICE_ICE_SERVERS_JSON",
        error,
      );
    }
  }

  const configuredServers = process.env.NEXT_PUBLIC_VOICE_ICE_SERVERS?.split(
    ",",
  )
    .map((value) => value.trim())
    .filter(Boolean);

  if (!configuredServers?.length) {
    return DEFAULT_ICE_SERVERS;
  }

  return [{ urls: configuredServers }];
}

const VOICE_AUDIO_SAMPLE_RATE = 24_000;

function floatTo16BitPCM(samples: Float32Array) {
  const output = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    output[index] =
      sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return output;
}

function encodeInt16ToBase64(samples: Int16Array) {
  const bytes = new Uint8Array(samples.buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function decodeBase64ToFloat32(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const pcm16 = new Int16Array(bytes.buffer);
  const output = new Float32Array(pcm16.length);
  for (let index = 0; index < pcm16.length; index += 1) {
    output[index] = pcm16[index] / 0x8000;
  }
  return output;
}

async function getVoiceRtcDiagnostics(pc: RTCPeerConnection) {
  const stats = await pc.getStats();
  let selectedPair:
    | (RTCStats & {
        localCandidateId?: string;
        remoteCandidateId?: string;
        state?: string;
      })
    | undefined;

  for (const stat of stats.values()) {
    if (
      stat.type === "transport" &&
      "selectedCandidatePairId" in stat &&
      stat.selectedCandidatePairId
    ) {
      selectedPair = stats.get(
        stat.selectedCandidatePairId,
      ) as typeof selectedPair;
      break;
    }
  }

  if (!selectedPair) {
    for (const stat of stats.values()) {
      if (
        stat.type === "candidate-pair" &&
        "state" in stat &&
        (stat.state === "succeeded" || (stat as any).selected)
      ) {
        selectedPair = stat as typeof selectedPair;
        break;
      }
    }
  }

  const localCandidate = selectedPair?.localCandidateId
    ? (stats.get(selectedPair.localCandidateId) as
        | (RTCStats & { candidateType?: string; protocol?: string })
        | undefined)
    : undefined;
  const remoteCandidate = selectedPair?.remoteCandidateId
    ? (stats.get(selectedPair.remoteCandidateId) as
        | (RTCStats & { candidateType?: string; protocol?: string })
        | undefined)
    : undefined;

  const gatheredCandidateTypes = new Set<string>();
  for (const stat of stats.values()) {
    if (stat.type === "local-candidate" || stat.type === "remote-candidate") {
      const candidateType = (stat as any).candidateType;
      if (candidateType) {
        gatheredCandidateTypes.add(candidateType);
      }
    }
  }

  return {
    connectionState: pc.connectionState,
    iceConnectionState: pc.iceConnectionState,
    iceGatheringState: pc.iceGatheringState,
    selectedPairState: selectedPair?.state,
    localCandidateType: localCandidate?.candidateType,
    remoteCandidateType: remoteCandidate?.candidateType,
    localProtocol: localCandidate?.protocol,
    remoteProtocol: remoteCandidate?.protocol,
    gatheredCandidateTypes: Array.from(gatheredCandidateTypes),
  };
}

type Content =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "tool-invocation";
      name: string;
      arguments: any;
      state: "call" | "result";
      toolCallId: string;
      result?: any;
    };

const createUIPart = (content: Content): TextPart | ToolUIPart => {
  if (content.type == "tool-invocation") {
    const part: ToolUIPart = {
      type: `tool-${content.name}`,
      input: content.arguments,
      state: "output-available",
      toolCallId: content.toolCallId,
      output: content.result,
    };
    return part;
  }
  return {
    type: "text",
    text: content.text,
  };
};

const createUIMessage = (m: {
  id?: string;
  role: "user" | "assistant";
  content: Content;
  completed?: boolean;
}): UIMessageWithCompleted => {
  const id = m.id ?? generateUUID();
  return {
    id,
    role: m.role,
    parts: [createUIPart(m.content)],
    completed: m.completed ?? false,
  };
};

export function useOpenAIVoiceChat(props?: VoiceChatOptions): VoiceChatSession {
  const { voice = OPENAI_VOICE.Ash } = props || {};

  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [messages, setMessages] = useState<UIMessageWithCompleted[]>([]);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);
  const webSocket = useRef<WebSocket | null>(null);
  const audioElement = useRef<HTMLAudioElement | null>(null);
  const audioStream = useRef<MediaStream | null>(null);
  const connectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transportRef = useRef<"webrtc" | "websocket" | null>(null);
  const fallbackAttemptedRef = useRef(false);
  const inputAudioContext = useRef<AudioContext | null>(null);
  const inputAudioSource = useRef<MediaStreamAudioSourceNode | null>(null);
  const inputAudioProcessor = useRef<ScriptProcessorNode | null>(null);
  const inputAudioSilenceGain = useRef<GainNode | null>(null);
  const outputAudioContext = useRef<AudioContext | null>(null);
  const outputAudioTime = useRef(0);
  const isListeningRef = useRef(false);

  const { setTheme } = useTheme();
  const tracks = useRef<RTCRtpSender[]>([]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  const waitForIceGatheringComplete = useCallback(
    (pc: RTCPeerConnection, timeoutMs = 4000) =>
      new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") {
          resolve();
          return;
        }

        const timeout = window.setTimeout(() => {
          cleanup();
          resolve();
        }, timeoutMs);

        const handleStateChange = () => {
          if (pc.iceGatheringState === "complete") {
            cleanup();
            resolve();
          }
        };

        const cleanup = () => {
          window.clearTimeout(timeout);
          pc.removeEventListener("icegatheringstatechange", handleStateChange);
        };

        pc.addEventListener("icegatheringstatechange", handleStateChange);
      }),
    [],
  );

  const ensureAudioStream = useCallback(async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new Error(
        "Microphone access is not available. Voice chat requires a secure connection (HTTPS or localhost).",
      );
    }
    if (!audioStream.current) {
      audioStream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
    }
    return audioStream.current;
  }, []);

  const stopWebSocketAudioCapture = useCallback(async () => {
    inputAudioProcessor.current?.disconnect();
    inputAudioSource.current?.disconnect();
    inputAudioSilenceGain.current?.disconnect();
    inputAudioProcessor.current = null;
    inputAudioSource.current = null;
    inputAudioSilenceGain.current = null;

    if (inputAudioContext.current) {
      await inputAudioContext.current.close().catch(() => {});
      inputAudioContext.current = null;
    }
  }, []);

  const startWebSocketAudioCapture = useCallback(
    async (socket: WebSocket) => {
      await stopWebSocketAudioCapture();
      const stream = await ensureAudioStream();
      const context = new AudioContext({ sampleRate: VOICE_AUDIO_SAMPLE_RATE });
      await context.resume();

      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silenceGain = context.createGain();
      silenceGain.gain.value = 0;

      processor.onaudioprocess = (audioEvent) => {
        if (
          socket.readyState !== WebSocket.OPEN ||
          !isListeningRef.current ||
          transportRef.current !== "websocket"
        ) {
          return;
        }

        const input = audioEvent.inputBuffer.getChannelData(0);
        const pcm16 = floatTo16BitPCM(input);
        socket.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: encodeInt16ToBase64(pcm16),
          }),
        );
      };

      source.connect(processor);
      processor.connect(silenceGain);
      silenceGain.connect(context.destination);

      inputAudioContext.current = context;
      inputAudioSource.current = source;
      inputAudioProcessor.current = processor;
      inputAudioSilenceGain.current = silenceGain;
    },
    [ensureAudioStream, stopWebSocketAudioCapture],
  );

  const playWebSocketAudioDelta = useCallback(async (base64Audio: string) => {
    const samples = decodeBase64ToFloat32(base64Audio);
    if (!outputAudioContext.current) {
      outputAudioContext.current = new AudioContext({
        sampleRate: VOICE_AUDIO_SAMPLE_RATE,
      });
      outputAudioTime.current = outputAudioContext.current.currentTime;
    }

    const context = outputAudioContext.current;
    await context.resume();

    const buffer = context.createBuffer(
      1,
      samples.length,
      VOICE_AUDIO_SAMPLE_RATE,
    );
    buffer.copyToChannel(samples, 0);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    const startAt = Math.max(context.currentTime, outputAudioTime.current);
    source.start(startAt);
    outputAudioTime.current = startAt + buffer.duration;
  }, []);

  const sendRealtimeEvent = useCallback((event: object) => {
    const payload = JSON.stringify(event);
    if (transportRef.current === "websocket" && webSocket.current) {
      if (webSocket.current.readyState === WebSocket.OPEN) {
        webSocket.current.send(payload);
      }
      return;
    }

    if (
      transportRef.current === "webrtc" &&
      dataChannel.current?.readyState === "open"
    ) {
      dataChannel.current.send(payload);
    }
  }, []);

  const startListening = useCallback(async () => {
    try {
      const stream = await ensureAudioStream();
      if (
        transportRef.current === "websocket" &&
        webSocket.current?.readyState === WebSocket.OPEN
      ) {
        await startWebSocketAudioCapture(webSocket.current);
      }
      if (tracks.current.length) {
        const micTrack = stream.getAudioTracks()[0];
        tracks.current.forEach((sender) => {
          sender.replaceTrack(micTrack);
        });
      }
      isListeningRef.current = true;
      setIsListening(true);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [ensureAudioStream, startWebSocketAudioCapture]);

  const stopListening = useCallback(async () => {
    try {
      if (
        transportRef.current === "websocket" &&
        webSocket.current?.readyState === WebSocket.OPEN
      ) {
        webSocket.current.send(
          JSON.stringify({ type: "input_audio_buffer.commit" }),
        );
        await stopWebSocketAudioCapture();
      }
      if (audioStream.current) {
        audioStream.current.getTracks().forEach((track) => track.stop());
        audioStream.current = null;
      }
      if (tracks.current.length) {
        const placeholderTrack = createEmptyAudioTrack();
        tracks.current.forEach((sender) => {
          sender.replaceTrack(placeholderTrack);
        });
      }
      isListeningRef.current = false;
      setIsListening(false);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [stopWebSocketAudioCapture]);

  const createSession =
    useCallback(async (): Promise<OpenAIRealtimeSession> => {
      const response = await fetch("/api/chat/openai-realtime", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          voice,
          agentId: props?.agentId,
          mentions: props?.toolMentions,
        }),
      });
      if (!response.ok) {
        const rawError = await response.text();
        try {
          const parsedError = JSON.parse(rawError);
          const message =
            typeof parsedError?.error === "string"
              ? parsedError.error
              : parsedError?.error?.message || rawError;
          throw new Error(message);
        } catch {
          throw new Error(rawError);
        }
      }
      const session = await response.json();
      if (session.error) {
        throw new Error(
          typeof session.error === "string"
            ? session.error
            : session.error.message || JSON.stringify(session.error),
        );
      }

      return session;
    }, [voice, props?.toolMentions, props?.agentId]);

  const updateUIMessage = useCallback(
    (
      id: string,
      action:
        | Partial<UIMessageWithCompleted>
        | ((
            message: UIMessageWithCompleted,
          ) => Partial<UIMessageWithCompleted>),
    ) => {
      setMessages((prev) => {
        if (prev.length) {
          const lastMessage = prev.find((m) => m.id == id);
          if (!lastMessage) return prev;
          const nextMessage =
            typeof action === "function" ? action(lastMessage) : action;
          if (lastMessage == nextMessage) return prev;
          return prev.map((m) => (m.id == id ? { ...m, ...nextMessage } : m));
        }
        return prev;
      });
    },
    [],
  );

  const clientFunctionCall = useCallback(
    async ({
      callId,
      toolName,
      args,
      id,
    }: { callId: string; toolName: string; args: string; id: string }) => {
      let toolResult: any = "success";
      stopListening();
      const toolArgs = JSON.parse(args);
      if (DEFAULT_VOICE_TOOLS.some((t) => t.name === toolName)) {
        switch (toolName) {
          case "changeBrowserTheme":
            setTheme(toolArgs?.theme);
            break;
          case "endConversation":
            await stop();
            setError(null);
            setMessages([]);
            appStore.setState((prev) => ({
              voiceChat: {
                ...prev.voiceChat,
                agentId: undefined,
                isOpen: false,
              },
            }));
            break;
        }
      } else {
        const toolId = extractMCPToolId(toolName);

        toolResult = await callMcpToolByServerNameAction(
          toolId.serverName,
          toolId.toolName,
          toolArgs,
        );
      }
      startListening();
      const resultText = JSON.stringify(toolResult).trim();

      const event = {
        type: "conversation.item.create",
        previous_item_id: id,
        item: {
          type: "function_call_output",
          call_id: callId,
          output: resultText.slice(0, 15000),
        },
      };
      updateUIMessage(id, (prev) => {
        const prevPart = prev.parts.find((p) => p.type == `tool-${toolName}`);
        if (!prevPart) return prev;
        const part: ToolUIPart = {
          state: "output-available",
          output: toolResult,
          toolCallId: callId,
          input: toolArgs,
          type: `tool-${toolName}`,
        };
        return {
          parts: [part],
        };
      });
      sendRealtimeEvent(event);
      sendRealtimeEvent({ type: "response.create" });
      sendRealtimeEvent({ type: "response.create" });
    },
    [
      sendRealtimeEvent,
      startListening,
      stopListening,
      setTheme,
      updateUIMessage,
    ],
  );

  const handleServerEvent = useCallback(
    (event: OpenAIRealtimeServerEvent) => {
      switch (event.type) {
        case "input_audio_buffer.speech_started": {
          const message = createUIMessage({
            role: "user",
            id: event.item_id,
            content: {
              type: "text",
              text: "",
            },
          });
          setIsUserSpeaking(true);
          setMessages((prev) => [...prev, message]);
          break;
        }
        case "input_audio_buffer.committed": {
          updateUIMessage(event.item_id, {
            parts: [
              {
                type: "text",
                text: "",
              },
            ],
            completed: true,
          });
          break;
        }
        case "conversation.item.input_audio_transcription.completed": {
          updateUIMessage(event.item_id, {
            parts: [
              {
                type: "text",
                text: event.transcript || "...speaking",
              },
            ],
            completed: true,
          });
          break;
        }
        case "response.audio_transcript.delta":
        case "response.output_audio_transcript.delta":
        case "response.output_text.delta": {
          setIsAssistantSpeaking(true);
          setMessages((prev) => {
            const message = prev.findLast((m) => m.id == event.item_id)!;
            if (message) {
              return prev.map((m) =>
                m.id == event.item_id
                  ? {
                      ...m,
                      parts: [
                        {
                          type: "text",
                          text:
                            (message.parts[0] as TextPart).text! + event.delta,
                        },
                      ],
                    }
                  : m,
              );
            }
            return [
              ...prev,
              createUIMessage({
                role: "assistant",
                id: event.item_id,
                content: {
                  type: "text",
                  text: event.delta,
                },
                completed: true,
              }),
            ];
          });
          break;
        }
        case "response.audio_transcript.done":
        case "response.output_audio_transcript.done":
        case "response.output_text.done": {
          updateUIMessage(event.item_id, (prev) => {
            const textPart = prev.parts.find((p) => p.type == "text");
            if (!textPart) return prev;
            (textPart as TextPart).text = event.transcript || "";
            return {
              ...prev,
              completed: true,
            };
          });
          break;
        }
        case "response.audio.delta": {
          playWebSocketAudioDelta(event.delta).catch((playbackError) => {
            console.error("voice websocket playback error", playbackError);
          });
          break;
        }
        case "response.audio.done": {
          break;
        }
        case "output_audio_buffer.started": {
          setIsAssistantSpeaking(true);
          break;
        }
        case "response.function_call_arguments.done": {
          const message = createUIMessage({
            role: "assistant",
            id: event.item_id,
            content: {
              type: "tool-invocation",
              name: event.name,
              arguments: JSON.parse(event.arguments),
              state: "call",
              toolCallId: event.call_id,
            },
            completed: true,
          });
          setMessages((prev) => [...prev, message]);
          clientFunctionCall({
            callId: event.call_id,
            toolName: event.name,
            args: event.arguments,
            id: event.item_id,
          });
          break;
        }
        case "input_audio_buffer.speech_stopped": {
          setIsUserSpeaking(false);
          break;
        }
        case "output_audio_buffer.stopped": {
          setIsAssistantSpeaking(false);
          break;
        }
        case "session.error": {
          setError(new Error(event.error.message));
          break;
        }
      }
    },
    [clientFunctionCall, playWebSocketAudioDelta, updateUIMessage],
  );

  const startWebSocketFallback = useCallback(
    async (session: OpenAIRealtimeSession, reason: string) => {
      if (fallbackAttemptedRef.current || !session.websocketEndpointUrl) {
        throw new Error("Voice WebSocket fallback is not available.");
      }

      fallbackAttemptedRef.current = true;
      transportRef.current = "websocket";

      if (connectTimeout.current) {
        clearTimeout(connectTimeout.current);
        connectTimeout.current = null;
      }
      dataChannel.current?.close();
      dataChannel.current = null;
      peerConnection.current?.close();
      peerConnection.current = null;
      tracks.current = [];

      setError(null);
      setIsLoading(true);
      console.warn("voice rtc fallback to websocket", reason);

      await ensureAudioStream();

      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(session.websocketEndpointUrl);
        webSocket.current = socket;

        socket.addEventListener("open", async () => {
          try {
            await startWebSocketAudioCapture(socket);
            const websocketSessionUpdate = {
              ...(session.websocketSessionUpdate ||
                session.pendingSessionUpdate),
              input_audio_format: "pcm16",
              output_audio_format: "pcm16",
              turn_detection: {
                type: "server_vad",
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 250,
                create_response: true,
              },
            };
            socket.send(
              JSON.stringify({
                type: "session.update",
                session: websocketSessionUpdate,
              }),
            );
            setIsActive(true);
            isListeningRef.current = true;
            setIsListening(true);
            setIsLoading(false);
            resolve();
          } catch (error) {
            reject(error);
          }
        });

        socket.addEventListener("message", (messageEvent) => {
          try {
            const event = JSON.parse(
              messageEvent.data,
            ) as OpenAIRealtimeServerEvent;
            handleServerEvent(event);
          } catch (error) {
            console.error("voice websocket message parse error", error);
          }
        });

        socket.addEventListener("error", () => {
          reject(new Error("Voice WebSocket connection failed."));
        });

        socket.addEventListener("close", () => {
          webSocket.current = null;
          stopWebSocketAudioCapture().catch(() => {});
          setIsActive(false);
          isListeningRef.current = false;
          setIsListening(false);
          setIsLoading(false);
        });
      });
    },
    [
      ensureAudioStream,
      handleServerEvent,
      startWebSocketAudioCapture,
      stopWebSocketAudioCapture,
    ],
  );

  const start = useCallback(async () => {
    if (isActive || isLoading) return;
    setIsLoading(true);
    setError(null);
    setMessages([]);
    try {
      fallbackAttemptedRef.current = false;
      transportRef.current = null;
      webSocket.current?.close();
      webSocket.current = null;
      const session = await createSession();
      console.log({ session });
      const sessionToken = session.client_secret.value;
      const realtimeEndpointUrl: string =
        session.realtimeEndpointUrl || "https://api.openai.com/v1/realtime";
      // proxySdpUrl: when set, the SDP offer is POSTed through our Next.js API.
      // We use this for legacy Azure api-key auth and GA Azure bearer-token forwarding.
      const proxySdpUrl: string | undefined = session.proxySdpUrl;
      // sdpAuthHeader: used for direct SDP exchange or forwarded to our proxy.
      const sdpAuthHeader: string = session.sdpAuthHeader || "Authorization";
      const sdpAuthValue =
        sdpAuthHeader === "Authorization"
          ? `Bearer ${sessionToken}`
          : sessionToken;
      const pc = new RTCPeerConnection({
        iceServers: getVoiceIceServers(),
        iceCandidatePoolSize: 4,
      });
      if (!audioElement.current) {
        audioElement.current = document.createElement("audio");
        audioElement.current.style.display = "none";
        document.body.appendChild(audioElement.current);
      }
      audioElement.current.autoplay = true;
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log("voice rtc connection", state);
        if (
          state === "failed" ||
          state === "disconnected" ||
          state === "closed"
        ) {
          if (connectTimeout.current) {
            clearTimeout(connectTimeout.current);
            connectTimeout.current = null;
          }
          if (
            state !== "closed" &&
            session.websocketEndpointUrl &&
            !fallbackAttemptedRef.current
          ) {
            startWebSocketFallback(
              session,
              `webrtc connection state ${state}`,
            ).catch((fallbackError) => {
              setIsLoading(false);
              setError(
                fallbackError instanceof Error
                  ? fallbackError
                  : new Error(String(fallbackError)),
              );
            });
            return;
          }
          setIsLoading(false);
          if (state !== "closed") {
            setError(new Error(`Voice WebRTC connection ${state}.`));
          }
        }
      };
      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        console.log("voice rtc ice", state);
        if (state === "failed") {
          if (connectTimeout.current) {
            clearTimeout(connectTimeout.current);
            connectTimeout.current = null;
          }
          if (session.websocketEndpointUrl && !fallbackAttemptedRef.current) {
            startWebSocketFallback(session, "webrtc ice failed").catch(
              (fallbackError) => {
                setIsLoading(false);
                setError(
                  fallbackError instanceof Error
                    ? fallbackError
                    : new Error(String(fallbackError)),
                );
              },
            );
            return;
          }
          setIsLoading(false);
          setError(new Error("Voice WebRTC ICE negotiation failed."));
        }
      };
      pc.onicecandidate = (event) => {
        if (!event.candidate) {
          console.log("voice rtc candidate", "end-of-candidates");
          return;
        }

        const candidate = event.candidate.candidate;
        const typeMatch = candidate.match(/\btyp\s+([a-z]+)/i);
        console.log("voice rtc candidate", typeMatch?.[1] || "unknown");
      };
      pc.onicecandidateerror = (event) => {
        console.error("voice rtc candidate error", {
          errorCode: event.errorCode,
          errorText: event.errorText,
          url: event.url,
        });
      };
      pc.ontrack = (e) => {
        if (audioElement.current) {
          audioElement.current.srcObject = e.streams[0];
        }
      };
      if (!audioStream.current) {
        if (!navigator?.mediaDevices?.getUserMedia) {
          throw new Error(
            "Microphone access is not available. Voice chat requires a secure connection (HTTPS or localhost).",
          );
        }
        audioStream.current = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
      }
      tracks.current = [];
      audioStream.current.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, audioStream.current!);
        if (sender) tracks.current.push(sender);
      });

      const dc = pc.createDataChannel("realtime-channel");
      dataChannel.current = dc;
      dc.addEventListener("message", async (e) => {
        try {
          const event = JSON.parse(e.data) as OpenAIRealtimeServerEvent;
          handleServerEvent(event);
        } catch (err) {
          console.error({
            data: e.data,
            error: err,
          });
        }
      });
      dc.addEventListener("open", () => {
        if (connectTimeout.current) {
          clearTimeout(connectTimeout.current);
          connectTimeout.current = null;
        }
        // Azure Voice Direct can only complete the SDP exchange server-side,
        // so session configuration is pushed once the data channel is ready.
        if (session.pendingSessionUpdate) {
          dc.send(
            JSON.stringify({
              type: "session.update",
              session: session.pendingSessionUpdate,
            }),
          );
        }
        setIsActive(true);
        setIsListening(true);
        setIsLoading(false);
      });
      dc.addEventListener("close", () => {
        if (connectTimeout.current) {
          clearTimeout(connectTimeout.current);
          connectTimeout.current = null;
        }
        setIsActive(false);
        setIsListening(false);
        setIsLoading(false);
      });
      dc.addEventListener("error", (errorEvent) => {
        if (connectTimeout.current) {
          clearTimeout(connectTimeout.current);
          connectTimeout.current = null;
        }
        console.error(errorEvent);
        setError(
          errorEvent instanceof Error
            ? errorEvent
            : new Error(String(errorEvent)),
        );
        setIsActive(false);
        setIsListening(false);
        setIsLoading(false);
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);
      const localSdp = pc.localDescription?.sdp;
      if (!localSdp) {
        throw new Error("Voice WebRTC local SDP was not created.");
      }

      // If proxySdpUrl is set (Azure dedicated config), POST the SDP through our
      // server-side proxy. Otherwise POST directly to the realtime endpoint.
      const sdpFetchUrl = proxySdpUrl ?? realtimeEndpointUrl;
      const sdpFetchHeaders: Record<string, string> = proxySdpUrl
        ? {
            "Content-Type": "application/sdp",
            ...(sessionToken !== "proxy"
              ? { [sdpAuthHeader]: sdpAuthValue }
              : {}),
          }
        : { [sdpAuthHeader]: sdpAuthValue, "Content-Type": "application/sdp" };

      const sdpResponse = await fetch(sdpFetchUrl, {
        method: "POST",
        body: localSdp,
        headers: sdpFetchHeaders,
      });
      const sdpResponseText = await sdpResponse.text();
      if (!sdpResponse.ok) {
        // Parse a JSON error body if present, else surface the raw text
        let errorMessage = `WebRTC SDP exchange failed (${sdpResponse.status})`;
        try {
          const errorBody = JSON.parse(sdpResponseText);
          const msg =
            errorBody?.error?.message ||
            errorBody?.message ||
            JSON.stringify(errorBody);
          errorMessage = `WebRTC SDP exchange failed: ${msg}`;
        } catch {
          if (sdpResponseText) errorMessage += `: ${sdpResponseText}`;
        }
        throw new Error(errorMessage);
      }
      const answer: RTCSessionDescriptionInit = {
        type: "answer",
        sdp: sdpResponseText,
      };
      await pc.setRemoteDescription(answer);
      peerConnection.current = pc;
      transportRef.current = "webrtc";
      connectTimeout.current = setTimeout(() => {
        if (
          dataChannel.current?.readyState !== "open" &&
          pc.connectionState !== "connected"
        ) {
          getVoiceRtcDiagnostics(pc)
            .then((diagnostics) => {
              console.error("voice rtc diagnostics", diagnostics);
              const hasReachableCandidateHint =
                diagnostics.gatheredCandidateTypes.includes("srflx") ||
                diagnostics.gatheredCandidateTypes.includes("relay");

              if (
                session.websocketEndpointUrl &&
                !fallbackAttemptedRef.current
              ) {
                startWebSocketFallback(
                  session,
                  `webrtc timeout (${diagnostics.gatheredCandidateTypes.join(",") || "no-candidates"})`,
                ).catch((fallbackError) => {
                  setError(
                    fallbackError instanceof Error
                      ? fallbackError
                      : new Error(String(fallbackError)),
                  );
                  setIsLoading(false);
                });
                return;
              }

              setError(
                new Error(
                  hasReachableCandidateHint
                    ? "Voice connection timed out while waiting for the realtime data channel."
                    : "Voice WebRTC could not establish a public candidate pair. Configure TURN/STUN via NEXT_PUBLIC_VOICE_ICE_SERVERS_JSON.",
                ),
              );
              setIsLoading(false);
            })
            .catch(() => {
              if (
                session.websocketEndpointUrl &&
                !fallbackAttemptedRef.current
              ) {
                startWebSocketFallback(session, "webrtc timeout").catch(
                  (fallbackError) => {
                    setError(
                      fallbackError instanceof Error
                        ? fallbackError
                        : new Error(String(fallbackError)),
                    );
                    setIsLoading(false);
                  },
                );
                return;
              }
              setError(
                new Error(
                  "Voice connection timed out while waiting for the realtime data channel.",
                ),
              );
              setIsLoading(false);
            });
        }
      }, 20000);
    } catch (err) {
      if (connectTimeout.current) {
        clearTimeout(connectTimeout.current);
        connectTimeout.current = null;
      }
      setError(err instanceof Error ? err : new Error(String(err)));
      setIsActive(false);
      setIsListening(false);
      setIsLoading(false);
    }
  }, [
    isActive,
    isLoading,
    createSession,
    handleServerEvent,
    startWebSocketFallback,
    voice,
    waitForIceGatheringComplete,
  ]);

  const stop = useCallback(async () => {
    try {
      transportRef.current = null;
      if (webSocket.current) {
        webSocket.current.close();
        webSocket.current = null;
      }
      if (dataChannel.current) {
        dataChannel.current.close();
        dataChannel.current = null;
      }
      if (peerConnection.current) {
        peerConnection.current.close();
        peerConnection.current = null;
      }
      if (connectTimeout.current) {
        clearTimeout(connectTimeout.current);
        connectTimeout.current = null;
      }
      await stopWebSocketAudioCapture();
      if (outputAudioContext.current) {
        await outputAudioContext.current.close().catch(() => {});
        outputAudioContext.current = null;
      }
      outputAudioTime.current = 0;
      tracks.current = [];
      stopListening();
      setIsActive(false);
      setIsListening(false);
      setIsLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [stopListening, stopWebSocketAudioCapture]);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  function createEmptyAudioTrack(): MediaStreamTrack {
    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();
    return destination.stream.getAudioTracks()[0];
  }

  return {
    isActive,
    isUserSpeaking,
    isAssistantSpeaking,
    isListening,
    isLoading,
    error,
    messages,
    start,
    stop,
    startListening,
    stopListening,
  };
}
