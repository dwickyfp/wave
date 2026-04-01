"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { generateUUID } from "lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VoiceChatOptions, VoiceChatSession } from "..";
import {
  OpenAIRealtimeServerEvent,
  OpenAIRealtimeSession,
} from "./openai-realtime-event";

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

const VOICE_AUDIO_SAMPLE_RATE = 24_000;
const VOICE_TTS_TIMEOUT_MS = 30_000;

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
    gatheredCandidateTypes: Array.from(gatheredCandidateTypes),
  };
}

function createEmptyAudioTrack(): MediaStreamTrack {
  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();
  return destination.stream.getAudioTracks()[0];
}

function stripMarkdownForSpeech(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/^\|/gm, "")
    .replace(/\|$/gm, "")
    .replace(/\|/g, ", ")
    .replace(/^\s*[-:,\s]+\s*$/gm, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/~~/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getAssistantSpeechText(message: UIMessage) {
  const rawText = message.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text || "")
    .join("\n\n");

  const speechText = stripMarkdownForSpeech(rawText);
  return speechText.slice(0, 12_000).trim();
}

function buildSpeechInstructions(text: string) {
  return `Say exactly the following text out loud. Do not add, remove, or paraphrase anything.\n\n${text}`;
}

export function useOpenAIVoiceChat(props?: VoiceChatOptions): VoiceChatSession {
  const { voice = OPENAI_VOICE.Ash, threadId } = props || {};

  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const [isSynthesizingSpeech, setIsSynthesizingSpeech] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const latestOptionsRef = useRef(props);
  const threadIdRef = useRef(threadId);
  const isListeningRef = useRef(false);
  const isActiveRef = useRef(false);
  const transportRef = useRef<"webrtc" | "websocket" | null>(null);
  const fallbackAttemptedRef = useRef(false);
  const connectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnLockedRef = useRef(false);
  const autoResumeListeningRef = useRef(false);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);
  const webSocket = useRef<WebSocket | null>(null);
  const audioElement = useRef<HTMLAudioElement | null>(null);
  const audioStream = useRef<MediaStream | null>(null);
  const tracks = useRef<RTCRtpSender[]>([]);
  const inputAudioContext = useRef<AudioContext | null>(null);
  const inputAudioSource = useRef<MediaStreamAudioSourceNode | null>(null);
  const inputAudioProcessor = useRef<ScriptProcessorNode | null>(null);
  const inputAudioSilenceGain = useRef<GainNode | null>(null);
  const outputAudioContext = useRef<AudioContext | null>(null);
  const outputAudioTime = useRef(0);

  useEffect(() => {
    latestOptionsRef.current = props;
  }, [props]);

  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

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

  const ensureAudioElement = useCallback(() => {
    if (!audioElement.current) {
      audioElement.current = document.createElement("audio");
      audioElement.current.style.display = "none";
      audioElement.current.autoplay = true;
      audioElement.current.setAttribute("playsinline", "true");
      document.body.appendChild(audioElement.current);
    }
    return audioElement.current;
  }, []);

  const resumeAudioElementPlayback = useCallback(async () => {
    const element = ensureAudioElement();
    if (element.paused && element.srcObject) {
      await element.play();
    }
  }, [ensureAudioElement]);

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

  const setListeningState = useCallback(
    async ({
      enabled,
      commitBuffer,
      releaseStream,
    }: {
      enabled: boolean;
      commitBuffer: boolean;
      releaseStream: boolean;
    }) => {
      if (enabled) {
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
        return;
      }

      if (
        commitBuffer &&
        transportRef.current === "websocket" &&
        webSocket.current?.readyState === WebSocket.OPEN
      ) {
        webSocket.current.send(
          JSON.stringify({ type: "input_audio_buffer.commit" }),
        );
      }

      await stopWebSocketAudioCapture();

      if (releaseStream && audioStream.current) {
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
    },
    [ensureAudioStream, startWebSocketAudioCapture, stopWebSocketAudioCapture],
  );

  const finishAgentTurn = useCallback(
    async (resumeListening = autoResumeListeningRef.current) => {
      if (speechTimeout.current) {
        clearTimeout(speechTimeout.current);
        speechTimeout.current = null;
      }

      turnLockedRef.current = false;
      autoResumeListeningRef.current = false;
      setIsSynthesizingSpeech(false);
      setIsAssistantSpeaking(false);

      if (resumeListening && isActiveRef.current) {
        await setListeningState({
          enabled: true,
          commitBuffer: false,
          releaseStream: false,
        }).catch((resumeError) => {
          setError(
            resumeError instanceof Error
              ? resumeError
              : new Error(String(resumeError)),
          );
        });
      }
    },
    [setListeningState],
  );

  const speakAssistantText = useCallback(
    async (text: string) => {
      const speechText = getAssistantSpeechText({
        id: "",
        role: "assistant",
        parts: [{ type: "text", text }],
      } as UIMessage);

      if (!speechText || !transportRef.current) {
        await finishAgentTurn();
        return;
      }

      setIsSynthesizingSpeech(true);
      speechTimeout.current = setTimeout(() => {
        void finishAgentTurn();
      }, VOICE_TTS_TIMEOUT_MS);

      sendRealtimeEvent({
        type: "response.create",
        response: {
          conversation: "none",
          input: [],
          instructions: buildSpeechInstructions(speechText),
          output_modalities: ["audio"],
        },
      });
    },
    [finishAgentTurn, sendRealtimeEvent],
  );

  const createSession =
    useCallback(async (): Promise<OpenAIRealtimeSession> => {
      const response = await fetch("/api/chat/openai-realtime", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          voice,
          agentId: latestOptionsRef.current?.agentId,
        }),
      });
      if (!response.ok) {
        const rawError = await response.text();
        let parsedMessage: string | null = null;
        try {
          const parsedError = JSON.parse(rawError);
          parsedMessage =
            typeof parsedError?.error === "string"
              ? parsedError.error
              : parsedError?.error?.message || rawError;
        } catch {
          parsedMessage = null;
        }
        throw new Error(
          parsedMessage || rawError || "Voice session bootstrap failed.",
        );
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
    }, [voice]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/chat/voice-agent",
        prepareSendMessagesRequest: ({ messages, id }) => {
          const lastMessage = messages.at(-1);
          if (!lastMessage) {
            throw new Error("Voice agent turn is missing the user message.");
          }

          return {
            body: {
              id,
              message: lastMessage,
              agentId: latestOptionsRef.current?.agentId,
              mentions: latestOptionsRef.current?.mentions,
              allowedMcpServers: latestOptionsRef.current?.allowedMcpServers,
              allowedAppDefaultToolkit:
                latestOptionsRef.current?.allowedAppDefaultToolkit,
            },
          };
        },
      }),
    [],
  );

  const {
    messages,
    status,
    sendMessage,
    setMessages,
    stop: stopChatResponse,
    error: chatError,
  } = useChat<UIMessage>({
    id: threadId ?? "voice-chat-pending",
    transport,
    generateId: generateUUID,
    onFinish: ({ message, isAbort }) => {
      if (isAbort) {
        void finishAgentTurn();
        return;
      }

      const speechText = getAssistantSpeechText(message);
      if (!speechText) {
        void finishAgentTurn();
        return;
      }

      void speakAssistantText(speechText);
    },
  });

  const sendVoiceTurn = useCallback(
    async (transcript: string) => {
      const userText = transcript.trim();
      if (!userText || turnLockedRef.current) {
        return;
      }

      if (!threadIdRef.current) {
        setError(
          new Error(
            "Voice chat thread is not initialized. Close and reopen the voice drawer.",
          ),
        );
        return;
      }

      turnLockedRef.current = true;
      autoResumeListeningRef.current = isListeningRef.current;
      setError(null);

      await setListeningState({
        enabled: false,
        commitBuffer: false,
        releaseStream: false,
      });

      await Promise.resolve(
        sendMessage({
          role: "user",
          parts: [{ type: "text", text: userText }],
        }),
      ).catch(async (sendError) => {
        setError(
          sendError instanceof Error ? sendError : new Error(String(sendError)),
        );
        await finishAgentTurn(false);
      });
    },
    [finishAgentTurn, sendMessage, setListeningState],
  );

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

  const handleServerEvent = useCallback(
    (event: OpenAIRealtimeServerEvent) => {
      switch (event.type) {
        case "input_audio_buffer.speech_started": {
          if (!turnLockedRef.current) {
            setIsUserSpeaking(true);
          }
          break;
        }
        case "conversation.item.input_audio_transcription.completed": {
          setIsUserSpeaking(false);
          if (event.transcript?.trim()) {
            void sendVoiceTurn(event.transcript);
          }
          break;
        }
        case "response.audio.delta":
        case "response.output_audio.delta": {
          playWebSocketAudioDelta(event.delta).catch((playbackError) => {
            console.error("voice websocket playback error", playbackError);
          });
          break;
        }
        case "output_audio_buffer.started": {
          setIsAssistantSpeaking(true);
          break;
        }
        case "response.audio.done":
        case "response.output_audio.done":
        case "output_audio_buffer.stopped": {
          void finishAgentTurn();
          break;
        }
        case "input_audio_buffer.speech_stopped": {
          setIsUserSpeaking(false);
          break;
        }
        case "response.done": {
          if (isSynthesizingSpeech) {
            void finishAgentTurn();
          }
          break;
        }
        case "session.error":
        case "error":
        case "invalid_request_error": {
          setError(new Error(event.error.message));
          void finishAgentTurn(false);
          break;
        }
      }
    },
    [
      finishAgentTurn,
      isSynthesizingSpeech,
      playWebSocketAudioDelta,
      sendVoiceTurn,
    ],
  );

  const startWebSocketFallback = useCallback(
    async (session: OpenAIRealtimeSession) => {
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
      setIsSessionLoading(true);

      await ensureAudioStream();

      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(session.websocketEndpointUrl);
        webSocket.current = socket;

        socket.addEventListener("open", async () => {
          try {
            await startWebSocketAudioCapture(socket);
            socket.send(
              JSON.stringify({
                type: "session.update",
                session:
                  session.websocketSessionUpdate ||
                  session.pendingSessionUpdate,
              }),
            );
            setIsActive(true);
            setIsSessionLoading(false);
            isActiveRef.current = true;
            isListeningRef.current = true;
            setIsListening(true);
            resolve();
          } catch (socketError) {
            reject(socketError);
          }
        });

        socket.addEventListener("message", (messageEvent) => {
          try {
            const event = JSON.parse(
              messageEvent.data,
            ) as OpenAIRealtimeServerEvent;
            handleServerEvent(event);
          } catch (socketError) {
            console.error("voice websocket message parse error", socketError);
          }
        });

        socket.addEventListener("error", () => {
          reject(new Error("Voice WebSocket connection failed."));
        });

        socket.addEventListener("close", () => {
          webSocket.current = null;
          void stopWebSocketAudioCapture();
          setIsActive(false);
          isActiveRef.current = false;
          isListeningRef.current = false;
          setIsListening(false);
          setIsSessionLoading(false);
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
    if (isActive || isSessionLoading) return;
    if (!threadIdRef.current) {
      setError(
        new Error(
          "Voice chat thread is not initialized. Close and reopen the voice drawer.",
        ),
      );
      return;
    }

    setIsSessionLoading(true);
    setError(null);
    setMessages([]);

    try {
      fallbackAttemptedRef.current = false;
      transportRef.current = null;
      webSocket.current?.close();
      webSocket.current = null;
      const session = await createSession();
      const sessionToken = session.client_secret.value;
      const realtimeEndpointUrl: string =
        session.realtimeEndpointUrl || "https://api.openai.com/v1/realtime";
      const proxySdpUrl: string | undefined = session.proxySdpUrl;
      const sdpAuthHeader: string = session.sdpAuthHeader || "Authorization";
      const sdpAuthValue =
        sdpAuthHeader === "Authorization"
          ? `Bearer ${sessionToken}`
          : sessionToken;
      const pc = new RTCPeerConnection({
        iceServers: getVoiceIceServers(),
        iceCandidatePoolSize: 4,
      });

      ensureAudioElement();

      pc.onconnectionstatechange = () => {
        if (
          transportRef.current === "websocket" ||
          peerConnection.current !== pc
        ) {
          return;
        }
        const state = pc.connectionState;
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
            startWebSocketFallback(session).catch((fallbackError) => {
              setIsSessionLoading(false);
              setError(
                fallbackError instanceof Error
                  ? fallbackError
                  : new Error(String(fallbackError)),
              );
            });
            return;
          }
          setIsSessionLoading(false);
          if (state !== "closed") {
            setError(new Error(`Voice WebRTC connection ${state}.`));
          }
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (
          transportRef.current === "websocket" ||
          peerConnection.current !== pc
        ) {
          return;
        }
        const state = pc.iceConnectionState;
        if (state === "failed") {
          if (connectTimeout.current) {
            clearTimeout(connectTimeout.current);
            connectTimeout.current = null;
          }
          if (session.websocketEndpointUrl && !fallbackAttemptedRef.current) {
            startWebSocketFallback(session).catch((fallbackError) => {
              setIsSessionLoading(false);
              setError(
                fallbackError instanceof Error
                  ? fallbackError
                  : new Error(String(fallbackError)),
              );
            });
            return;
          }
          setIsSessionLoading(false);
          setError(new Error("Voice WebRTC ICE negotiation failed."));
        }
      };

      pc.ontrack = (event) => {
        const element = ensureAudioElement();
        element.srcObject = event.streams[0];
        resumeAudioElementPlayback().catch(() => {});
      };

      if (!audioStream.current) {
        await ensureAudioStream();
      }

      tracks.current = [];
      audioStream.current?.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, audioStream.current!);
        if (sender) tracks.current.push(sender);
      });

      const dc = pc.createDataChannel("realtime-channel");
      dataChannel.current = dc;
      dc.addEventListener("message", async (messageEvent) => {
        try {
          const event = JSON.parse(
            messageEvent.data,
          ) as OpenAIRealtimeServerEvent;
          handleServerEvent(event);
        } catch (channelError) {
          console.error({
            data: messageEvent.data,
            error: channelError,
          });
        }
      });
      dc.addEventListener("open", () => {
        if (connectTimeout.current) {
          clearTimeout(connectTimeout.current);
          connectTimeout.current = null;
        }
        if (session.pendingSessionUpdate) {
          dc.send(
            JSON.stringify({
              type: "session.update",
              session: session.pendingSessionUpdate,
            }),
          );
        }
        setIsActive(true);
        isActiveRef.current = true;
        setIsListening(true);
        isListeningRef.current = true;
        setIsSessionLoading(false);
      });
      dc.addEventListener("close", () => {
        if (connectTimeout.current) {
          clearTimeout(connectTimeout.current);
          connectTimeout.current = null;
        }
        setIsActive(false);
        isActiveRef.current = false;
        setIsListening(false);
        isListeningRef.current = false;
        setIsSessionLoading(false);
      });
      dc.addEventListener("error", (errorEvent) => {
        if (connectTimeout.current) {
          clearTimeout(connectTimeout.current);
          connectTimeout.current = null;
        }
        setError(
          errorEvent instanceof Error
            ? errorEvent
            : new Error(String(errorEvent)),
        );
        setIsActive(false);
        isActiveRef.current = false;
        setIsListening(false);
        isListeningRef.current = false;
        setIsSessionLoading(false);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);
      const localSdp = pc.localDescription?.sdp;
      if (!localSdp) {
        throw new Error("Voice WebRTC local SDP was not created.");
      }

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
        let errorMessage = `WebRTC SDP exchange failed (${sdpResponse.status})`;
        try {
          const errorBody = JSON.parse(sdpResponseText);
          const message =
            errorBody?.error?.message ||
            errorBody?.message ||
            JSON.stringify(errorBody);
          errorMessage = `WebRTC SDP exchange failed: ${message}`;
        } catch {
          if (sdpResponseText) errorMessage += `: ${sdpResponseText}`;
        }
        throw new Error(errorMessage);
      }

      await pc.setRemoteDescription({
        type: "answer",
        sdp: sdpResponseText,
      });
      peerConnection.current = pc;
      transportRef.current = "webrtc";

      connectTimeout.current = setTimeout(() => {
        if (
          transportRef.current === "websocket" ||
          peerConnection.current !== pc
        ) {
          return;
        }
        if (
          dataChannel.current?.readyState !== "open" &&
          pc.connectionState !== "connected"
        ) {
          getVoiceRtcDiagnostics(pc)
            .then((diagnostics) => {
              const hasReachableCandidateHint =
                diagnostics.gatheredCandidateTypes.includes("srflx") ||
                diagnostics.gatheredCandidateTypes.includes("relay");

              if (
                session.websocketEndpointUrl &&
                !fallbackAttemptedRef.current
              ) {
                startWebSocketFallback(session).catch((fallbackError) => {
                  setError(
                    fallbackError instanceof Error
                      ? fallbackError
                      : new Error(String(fallbackError)),
                  );
                  setIsSessionLoading(false);
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
              setIsSessionLoading(false);
            })
            .catch(() => {
              if (
                session.websocketEndpointUrl &&
                !fallbackAttemptedRef.current
              ) {
                startWebSocketFallback(session).catch((fallbackError) => {
                  setError(
                    fallbackError instanceof Error
                      ? fallbackError
                      : new Error(String(fallbackError)),
                  );
                  setIsSessionLoading(false);
                });
                return;
              }
              setError(
                new Error(
                  "Voice connection timed out while waiting for the realtime data channel.",
                ),
              );
              setIsSessionLoading(false);
            });
        }
      }, 20_000);
    } catch (startError) {
      if (connectTimeout.current) {
        clearTimeout(connectTimeout.current);
        connectTimeout.current = null;
      }
      setError(
        startError instanceof Error
          ? startError
          : new Error(String(startError)),
      );
      setIsActive(false);
      isActiveRef.current = false;
      setIsListening(false);
      isListeningRef.current = false;
      setIsSessionLoading(false);
    }
  }, [
    createSession,
    ensureAudioElement,
    ensureAudioStream,
    handleServerEvent,
    isActive,
    isSessionLoading,
    resumeAudioElementPlayback,
    setMessages,
    startWebSocketFallback,
    waitForIceGatheringComplete,
  ]);

  const startListening = useCallback(async () => {
    if (turnLockedRef.current || isSynthesizingSpeech || status !== "ready") {
      return;
    }

    try {
      autoResumeListeningRef.current = false;
      await setListeningState({
        enabled: true,
        commitBuffer: false,
        releaseStream: false,
      });
    } catch (listenError) {
      setError(
        listenError instanceof Error
          ? listenError
          : new Error(String(listenError)),
      );
    }
  }, [isSynthesizingSpeech, setListeningState, status]);

  const stopListening = useCallback(async () => {
    try {
      autoResumeListeningRef.current = false;
      await setListeningState({
        enabled: false,
        commitBuffer: true,
        releaseStream: true,
      });
    } catch (listenError) {
      setError(
        listenError instanceof Error
          ? listenError
          : new Error(String(listenError)),
      );
    }
  }, [setListeningState]);

  const stop = useCallback(async () => {
    try {
      autoResumeListeningRef.current = false;
      turnLockedRef.current = false;
      if (speechTimeout.current) {
        clearTimeout(speechTimeout.current);
        speechTimeout.current = null;
      }
      stopChatResponse();
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
      if (audioElement.current) {
        audioElement.current.pause();
        audioElement.current.srcObject = null;
      }
      if (audioStream.current) {
        audioStream.current.getTracks().forEach((track) => track.stop());
        audioStream.current = null;
      }
      outputAudioTime.current = 0;
      tracks.current = [];
      setIsActive(false);
      isActiveRef.current = false;
      setIsListening(false);
      isListeningRef.current = false;
      setIsSessionLoading(false);
      setIsSynthesizingSpeech(false);
      setIsAssistantSpeaking(false);
      setIsUserSpeaking(false);
    } catch (stopError) {
      setError(
        stopError instanceof Error ? stopError : new Error(String(stopError)),
      );
    }
  }, [stopChatResponse, stopWebSocketAudioCapture]);

  useEffect(() => {
    if (!chatError) {
      return;
    }
    setError(
      chatError instanceof Error ? chatError : new Error(String(chatError)),
    );
    void finishAgentTurn(false);
  }, [chatError, finishAgentTurn]);

  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      return;
    }
    setMessages([]);
  }, [setMessages, threadId]);

  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  return {
    isActive,
    isUserSpeaking,
    isAssistantSpeaking,
    isListening,
    isLoading: isSessionLoading,
    isProcessingTurn:
      status === "submitted" || status === "streaming" || isSynthesizingSpeech,
    error,
    messages,
    start,
    stop,
    startListening,
    stopListening,
  };
}
