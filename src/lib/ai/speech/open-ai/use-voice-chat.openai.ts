"use client";

import { appStore } from "@/app/store";
import { useGenerateThreadTitle } from "@/hooks/queries/use-generate-thread-title";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type UIMessage,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import type { ChatMetadata } from "app-types/chat";
import {
  isTranscriptCompatibleWithLanguage,
  pickVoiceLanguageHint,
} from "lib/ai/speech/voice-language";
import {
  isLikelyEchoTranscript,
  isLikelyGhostTranscript,
  shouldIgnoreShortAutoResumeTranscript,
} from "lib/ai/speech/voice-transcript-guard";
import { resolveThreadTitleFinishAction } from "lib/chat/thread-title-finish";
import { generateUUID } from "lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mutate } from "swr";
import { VoiceChatOptions, VoiceChatSession } from "..";
import {
  OpenAIRealtimeServerEvent,
  OpenAIRealtimeSession,
  type VoiceSessionMode,
} from "./openai-realtime-event";
import {
  appendOrReplaceRealtimeMessageText,
  getLatestVoiceTurnMessages,
  upsertRealtimeToolPart,
} from "./realtime-voice-state";
import {
  type VoiceFillerStage,
  buildVoiceFillerInstructions,
  buildVoiceToolResumeInstructions,
} from "./realtime-voice-tools";
import { getVoiceInputBufferAction } from "./voice-input-buffer";
import { buildSpeechInstructions } from "./voice-speech-instructions";
import {
  buildRealtimeResponseKey,
  shouldHandleRealtimeTtsCompletion,
} from "./voice-tts-response";
import {
  clearVoiceTurnTtsState,
  completeVoiceTurnTtsChunk,
  createVoiceTurnTtsState,
  deriveVoiceTurnTtsState,
  getLatestTurnAssistantSpeechText,
  hasActiveVoiceTurnTtsWork,
  hasPendingVoiceToolCalls,
  shiftVoiceTurnTtsQueue,
  shouldFinishVoiceTurnTts,
} from "./voice-turn-tts";

export const OPENAI_VOICE = {
  Alloy: "alloy",
  Ballad: "ballad",
  Sage: "sage",
  Shimmer: "shimmer",
  Verse: "verse",
  Echo: "echo",
  Coral: "coral",
  Ash: "ash",
  Marin: "marin",
  Cedar: "cedar",
};

export const OPENAI_VOICE_OPTIONS = [
  {
    value: OPENAI_VOICE.Alloy,
    label: "Alloy",
    description: "Neutral synthetic voice",
  },
  {
    value: OPENAI_VOICE.Ash,
    label: "Ash",
    description: "Calm and low-register",
  },
  {
    value: OPENAI_VOICE.Ballad,
    label: "Ballad",
    description: "Soft and conversational",
  },
  {
    value: OPENAI_VOICE.Cedar,
    label: "Cedar",
    description: "Higher-quality expressive voice",
  },
  {
    value: OPENAI_VOICE.Coral,
    label: "Coral",
    description: "Current app default",
  },
  {
    value: OPENAI_VOICE.Echo,
    label: "Echo",
    description: "Crisp and brighter tone",
  },
  {
    value: OPENAI_VOICE.Marin,
    label: "Marin",
    description: "Higher-quality expressive voice",
  },
  {
    value: OPENAI_VOICE.Sage,
    label: "Sage",
    description: "Measured and steady",
  },
  {
    value: OPENAI_VOICE.Shimmer,
    label: "Shimmer",
    description: "Lighter and more airy",
  },
  {
    value: OPENAI_VOICE.Verse,
    label: "Verse",
    description: "Balanced narration style",
  },
] as const;

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  {
    urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
  },
];

const VOICE_AUDIO_SAMPLE_RATE = 24_000;
const VOICE_TTS_TIMEOUT_MS = 30_000;
const VOICE_RESUME_LISTENING_DELAY_MS = 2_200;
const VOICE_ECHO_GUARD_MAX_MS = 15_000;
const VOICE_SHORT_TRANSCRIPT_GRACE_MS = 2_500;
const VOICE_AUTO_RESUME_TRANSCRIPT_GRACE_MS = 2_600;
const VOICE_SHORT_TRANSCRIPT_MAX_CHARS = 16;
const VOICE_SHORT_TRANSCRIPT_MAX_WORDS = 2;
const VOICE_SHORT_TRANSCRIPT_MAX_DURATION_MS = 900;
const VOICE_TTS_EXACT_ROUTE = "/api/chat/voice-tts";

type ExactVoiceTtsResult = "played" | "fallback" | "aborted";

type QueuedNativeResponseKind =
  | {
      kind: "filler";
      callId: string;
      toolName: string;
      stage: VoiceFillerStage;
    }
  | {
      kind: "tool-resume";
      callId: string;
      toolName: string;
    };

function estimateSpeechDurationMs(text: string) {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

  return Math.min(
    VOICE_ECHO_GUARD_MAX_MS,
    Math.max(4_000, wordCount * 350 + VOICE_RESUME_LISTENING_DELAY_MS),
  );
}

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

function parseRealtimeToolArguments(argumentsText?: string) {
  if (!argumentsText?.trim()) {
    return {};
  }

  try {
    return JSON.parse(argumentsText);
  } catch {
    return { raw: argumentsText };
  }
}
export function useOpenAIVoiceChat(props?: VoiceChatOptions): VoiceChatSession {
  const {
    voice = OPENAI_VOICE.Ash,
    threadId,
    transcriptionLanguage,
    voiceMode = "realtime_native",
  } = props || {};
  const generateTitle = useGenerateThreadTitle({
    threadId: threadId ?? "voice-chat-pending",
  });

  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const [isSynthesizingSpeech, setIsSynthesizingSpeech] = useState(false);
  const [liveInputTranscript, setLiveInputTranscript] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const [sessionMode, setSessionMode] = useState<VoiceSessionMode>(voiceMode);
  const [phase, setPhase] = useState<VoiceChatSession["phase"]>("idle");
  const [transport, setTransport] =
    useState<VoiceChatSession["transport"]>(null);
  const [nativeMessages, setNativeMessages] = useState<UIMessage[]>([]);
  const [activeResponseId, setActiveResponseId] = useState<string | null>(null);
  const [lastAssistantItemId, setLastAssistantItemId] = useState<string | null>(
    null,
  );
  const [pendingToolCalls, setPendingToolCalls] = useState<
    VoiceChatSession["pendingToolCalls"]
  >([]);
  const [timeline, setTimeline] = useState<VoiceChatSession["timeline"]>([]);

  const preferredVoiceLanguage = useMemo(() => {
    const browserLanguages =
      typeof navigator === "undefined"
        ? []
        : [...(navigator.languages ?? []), navigator.language];
    const browserTimeZone =
      typeof Intl === "undefined"
        ? undefined
        : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const documentLanguage =
      typeof document === "undefined"
        ? undefined
        : document.documentElement.lang;

    return pickVoiceLanguageHint({
      candidates: [
        transcriptionLanguage,
        ...browserLanguages,
        documentLanguage,
      ],
      timeZone: browserTimeZone,
    });
  }, [transcriptionLanguage]);

  const latestOptionsRef = useRef(props);
  const threadIdRef = useRef(threadId);
  const preferredVoiceLanguageRef = useRef(preferredVoiceLanguage);
  const sessionModeRef = useRef<VoiceSessionMode>(voiceMode);
  const isListeningRef = useRef(false);
  const isActiveRef = useRef(false);
  const activeResponseIdRef = useRef<string | null>(null);
  const lastAssistantItemIdRef = useRef<string | null>(null);
  const nativeMessagesRef = useRef<UIMessage[]>([]);
  const pendingToolCallsRef = useRef<VoiceChatSession["pendingToolCalls"]>([]);
  const timelineRef = useRef<VoiceChatSession["timeline"]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const realtimeModelRef = useRef<string | null>(null);
  const fillerDelayMsRef = useRef(200);
  const progressDelayMsRef = useRef(1_800);
  const longProgressDelayMsRef = useRef(4_500);
  const voiceToolsByNameRef = useRef<
    Record<string, NonNullable<OpenAIRealtimeSession["voiceTools"]>[number]>
  >({});
  const queuedClientResponseKindsRef = useRef<QueuedNativeResponseKind[]>([]);
  const currentResponseKindRef = useRef<
    QueuedNativeResponseKind | { kind: "model" } | null
  >(null);
  const fillerResponseIdRef = useRef<string | null>(null);
  const toolProgressTimeoutsRef = useRef<
    Map<string, ReturnType<typeof setTimeout>[]>
  >(new Map());
  const assistantPlaybackStartedAtRef = useRef<number | null>(null);
  const lastPersistedAssistantMessageIdRef = useRef<string | null>(null);
  const lastUserTranscriptCompletedAtRef = useRef<number | null>(null);
  const lastToolResumeRequestedAtRef = useRef<{
    callId: string;
    toolName: string;
    at: number;
  } | null>(null);
  const transportRef = useRef<"webrtc" | "websocket" | null>(null);
  const fallbackAttemptedRef = useRef(false);
  const connectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeListeningTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const turnLockedRef = useRef(false);
  const autoResumeListeningRef = useRef(false);
  const lastAssistantSpeechRef = useRef("");
  const assistantEchoGuardUntilRef = useRef(0);
  const lastAutoResumeAtRef = useRef(0);
  const listeningEnabledAtRef = useRef(0);
  const speechStartedAtRef = useRef<number | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);
  const webSocket = useRef<WebSocket | null>(null);
  const audioElement = useRef<HTMLAudioElement | null>(null);
  const ttsAudioElement = useRef<HTMLAudioElement | null>(null);
  const audioStream = useRef<MediaStream | null>(null);
  const tracks = useRef<RTCRtpSender[]>([]);
  const inputAudioContext = useRef<AudioContext | null>(null);
  const inputAudioSource = useRef<MediaStreamAudioSourceNode | null>(null);
  const inputAudioProcessor = useRef<ScriptProcessorNode | null>(null);
  const inputAudioSilenceGain = useRef<GainNode | null>(null);
  const websocketBufferedInputSamplesRef = useRef(0);
  const outputAudioContext = useRef<AudioContext | null>(null);
  const outputAudioTime = useRef(0);
  const voiceTurnTtsStateRef = useRef(createVoiceTurnTtsState());
  const ttsRequestInFlightRef = useRef(false);
  const exactTtsModeRef = useRef<"auto" | "exact" | "realtime">("auto");
  const exactTtsAbortControllerRef = useRef<AbortController | null>(null);
  const activeExactTtsObjectUrlRef = useRef<string | null>(null);
  const activeTtsResponseKeyRef = useRef<string | null>(null);
  const lastHandledTtsResponseKeyRef = useRef<string | null>(null);

  useEffect(() => {
    latestOptionsRef.current = props;
  }, [props]);

  useEffect(() => {
    preferredVoiceLanguageRef.current = preferredVoiceLanguage;
  }, [preferredVoiceLanguage]);

  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    nativeMessagesRef.current = nativeMessages;
  }, [nativeMessages]);

  useEffect(() => {
    activeResponseIdRef.current = activeResponseId;
  }, [activeResponseId]);

  useEffect(() => {
    lastAssistantItemIdRef.current = lastAssistantItemId;
  }, [lastAssistantItemId]);

  useEffect(() => {
    pendingToolCallsRef.current = pendingToolCalls;
  }, [pendingToolCalls]);

  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  const setSessionModeState = useCallback((nextMode: VoiceSessionMode) => {
    sessionModeRef.current = nextMode;
    setSessionMode(nextMode);
  }, []);

  const setTransportState = useCallback(
    (nextTransport: VoiceChatSession["transport"]) => {
      transportRef.current = nextTransport;
      setTransport(nextTransport);
    },
    [],
  );

  useEffect(() => {
    if (!isActiveRef.current) {
      setSessionModeState(voiceMode);
    }
  }, [setSessionModeState, voiceMode]);

  const pushTimeline = useCallback(
    (type: string, details?: Record<string, unknown>) => {
      setTimeline((current) => {
        const next = [
          ...current.slice(-79),
          {
            at: Date.now(),
            type,
            ...(details ? { details } : {}),
          },
        ];
        timelineRef.current = next;
        return next;
      });
    },
    [],
  );

  const replaceNativeMessages = useCallback(
    (updater: UIMessage[] | ((current: UIMessage[]) => UIMessage[])) => {
      setNativeMessages((current) => {
        const next = typeof updater === "function" ? updater(current) : updater;
        nativeMessagesRef.current = next;
        return next;
      });
    },
    [],
  );

  const setPendingToolCallsState = useCallback(
    (
      updater:
        | VoiceChatSession["pendingToolCalls"]
        | ((
            current: VoiceChatSession["pendingToolCalls"],
          ) => VoiceChatSession["pendingToolCalls"]),
    ) => {
      setPendingToolCalls((current) => {
        const next = typeof updater === "function" ? updater(current) : updater;
        pendingToolCallsRef.current = next;
        return next;
      });
    },
    [],
  );

  const clearToolProgressTimers = useCallback((callId?: string) => {
    if (!callId) {
      toolProgressTimeoutsRef.current.forEach((timeouts) => {
        timeouts.forEach((timeout) => clearTimeout(timeout));
      });
      toolProgressTimeoutsRef.current.clear();
      return;
    }

    const timeouts = toolProgressTimeoutsRef.current.get(callId);
    if (!timeouts?.length) {
      return;
    }

    timeouts.forEach((timeout) => clearTimeout(timeout));
    toolProgressTimeoutsRef.current.delete(callId);
  }, []);

  const clearNativeConversationState = useCallback(
    (clearTimeline = true) => {
      clearToolProgressTimers();
      activeResponseIdRef.current = null;
      lastAssistantItemIdRef.current = null;
      pendingToolCallsRef.current = [];
      nativeMessagesRef.current = [];
      currentResponseKindRef.current = null;
      fillerResponseIdRef.current = null;
      lastUserTranscriptCompletedAtRef.current = null;
      lastToolResumeRequestedAtRef.current = null;
      setActiveResponseId(null);
      setLastAssistantItemId(null);
      setPendingToolCalls([]);
      setNativeMessages([]);

      if (clearTimeline) {
        timelineRef.current = [];
        setTimeline([]);
      }
    },
    [clearToolProgressTimers],
  );

  const persistLatestNativeTurn = useCallback(async () => {
    if (
      sessionModeRef.current !== "realtime_native" ||
      !threadIdRef.current ||
      !nativeMessagesRef.current.length
    ) {
      return;
    }

    const latestTurnMessages = getLatestVoiceTurnMessages(
      nativeMessagesRef.current,
    );
    const latestAssistantMessage = [...latestTurnMessages]
      .reverse()
      .find((message) => message.role === "assistant");

    if (
      !latestAssistantMessage ||
      latestAssistantMessage.id === lastPersistedAssistantMessageIdRef.current
    ) {
      return;
    }

    lastPersistedAssistantMessageIdRef.current = latestAssistantMessage.id;

    await fetch("/api/voice/persist-turn", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        threadId: threadIdRef.current,
        messages: latestTurnMessages,
        metadata: {
          user: {
            responseMode: "voice",
            voiceMode: "realtime_native",
            agentId: latestOptionsRef.current?.agentId,
            source: "chat",
          } satisfies ChatMetadata,
          assistant: {
            responseMode: "voice",
            voiceMode: "realtime_native",
            agentId: latestOptionsRef.current?.agentId,
            source: "chat",
            ...(realtimeModelRef.current
              ? {
                  chatModel: {
                    provider: "openai",
                    model: realtimeModelRef.current,
                  },
                }
              : {}),
          } satisfies ChatMetadata,
        },
      }),
    }).catch(() => {});
  }, []);

  const flushSessionEvents = useCallback(async () => {
    if (!threadIdRef.current || !timelineRef.current.length) {
      return;
    }

    await fetch("/api/voice/session-events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionIdRef.current ?? threadIdRef.current,
        threadId: threadIdRef.current,
        agentId: latestOptionsRef.current?.agentId,
        transport: transportRef.current,
        events: timelineRef.current,
      }),
    }).catch(() => {});
  }, []);

  const ensureAudioStream = useCallback(async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new Error(
        "Microphone access is not available. Voice chat requires a secure connection (HTTPS or localhost).",
      );
    }
    if (!audioStream.current) {
      audioStream.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    }
    return audioStream.current;
  }, []);

  const getPlaybackResumeDelayMs = useCallback(() => {
    if (
      transportRef.current === "websocket" &&
      outputAudioContext.current &&
      outputAudioTime.current > 0
    ) {
      const remainingMs = Math.max(
        0,
        (outputAudioTime.current - outputAudioContext.current.currentTime) *
          1000,
      );
      return remainingMs + VOICE_RESUME_LISTENING_DELAY_MS;
    }

    return VOICE_RESUME_LISTENING_DELAY_MS;
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
        websocketBufferedInputSamplesRef.current += pcm16.length;
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

  const ensureTtsAudioElement = useCallback(() => {
    if (!ttsAudioElement.current) {
      ttsAudioElement.current = document.createElement("audio");
      ttsAudioElement.current.style.display = "none";
      ttsAudioElement.current.autoplay = false;
      ttsAudioElement.current.preload = "auto";
      ttsAudioElement.current.setAttribute("playsinline", "true");
      document.body.appendChild(ttsAudioElement.current);
    }
    return ttsAudioElement.current;
  }, []);

  const resumeAudioElementPlayback = useCallback(async () => {
    const element = ensureAudioElement();
    if (element.paused && element.srcObject) {
      await element.play();
    }
  }, [ensureAudioElement]);

  const cleanupExactTtsPlayback = useCallback(() => {
    exactTtsAbortControllerRef.current?.abort();
    exactTtsAbortControllerRef.current = null;

    if (activeExactTtsObjectUrlRef.current) {
      URL.revokeObjectURL(activeExactTtsObjectUrlRef.current);
      activeExactTtsObjectUrlRef.current = null;
    }

    if (ttsAudioElement.current) {
      ttsAudioElement.current.pause();
      ttsAudioElement.current.removeAttribute("src");
      ttsAudioElement.current.load();
    }
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
        websocketBufferedInputSamplesRef.current = 0;
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
        listeningEnabledAtRef.current = Date.now();
        setIsListening(true);
        return;
      }

      if (
        commitBuffer &&
        transportRef.current === "websocket" &&
        webSocket.current?.readyState === WebSocket.OPEN
      ) {
        const bufferAction = getVoiceInputBufferAction({
          bufferedSamples: websocketBufferedInputSamplesRef.current,
          sampleRate: VOICE_AUDIO_SAMPLE_RATE,
        });
        webSocket.current.send(
          JSON.stringify({
            type:
              bufferAction === "commit"
                ? "input_audio_buffer.commit"
                : "input_audio_buffer.clear",
          }),
        );
      }

      await stopWebSocketAudioCapture();
      websocketBufferedInputSamplesRef.current = 0;

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
      listeningEnabledAtRef.current = 0;
      setIsListening(false);
    },
    [ensureAudioStream, startWebSocketAudioCapture, stopWebSocketAudioCapture],
  );

  const clearSpeechTimeout = useCallback(() => {
    if (speechTimeout.current) {
      clearTimeout(speechTimeout.current);
      speechTimeout.current = null;
    }
  }, []);

  const syncSpeechActivityState = useCallback(() => {
    setIsSynthesizingSpeech(
      hasActiveVoiceTurnTtsWork(voiceTurnTtsStateRef.current),
    );
  }, []);

  const playExactSpeechChunk = useCallback(
    async (text: string): Promise<ExactVoiceTtsResult> => {
      const controller = new AbortController();
      exactTtsAbortControllerRef.current = controller;

      let response: Response;
      try {
        response = await fetch(VOICE_TTS_EXACT_ROUTE, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
            voice,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          if (exactTtsAbortControllerRef.current === controller) {
            exactTtsAbortControllerRef.current = null;
          }
          return "aborted";
        }

        console.warn("voice exact tts request failed", error);
        if (exactTtsAbortControllerRef.current === controller) {
          exactTtsAbortControllerRef.current = null;
        }
        return "fallback";
      }

      if (!response.ok) {
        const errorMessage = await response.text().catch(() => "");
        console.warn("voice exact tts unavailable", {
          status: response.status,
          error: errorMessage,
        });
        if (exactTtsAbortControllerRef.current === controller) {
          exactTtsAbortControllerRef.current = null;
        }
        return "fallback";
      }

      const audioBlob = await response.blob();
      if (controller.signal.aborted) {
        if (exactTtsAbortControllerRef.current === controller) {
          exactTtsAbortControllerRef.current = null;
        }
        return "aborted";
      }

      const element = ensureTtsAudioElement();
      const objectUrl = URL.createObjectURL(audioBlob);
      activeExactTtsObjectUrlRef.current = objectUrl;
      element.srcObject = null;
      element.src = objectUrl;
      element.currentTime = 0;
      setIsAssistantSpeaking(true);

      return new Promise<ExactVoiceTtsResult>((resolve, reject) => {
        const cleanupListeners = () => {
          element.onended = null;
          element.onerror = null;
          controller.signal.removeEventListener("abort", handleAbort);
          if (exactTtsAbortControllerRef.current === controller) {
            exactTtsAbortControllerRef.current = null;
          }
        };

        const handleAbort = () => {
          cleanupListeners();
          setIsAssistantSpeaking(false);

          if (activeExactTtsObjectUrlRef.current === objectUrl) {
            URL.revokeObjectURL(objectUrl);
            activeExactTtsObjectUrlRef.current = null;
          }

          element.pause();
          element.removeAttribute("src");
          element.load();
          resolve("aborted");
        };

        element.onended = () => {
          cleanupListeners();
          setIsAssistantSpeaking(false);

          if (activeExactTtsObjectUrlRef.current === objectUrl) {
            URL.revokeObjectURL(objectUrl);
            activeExactTtsObjectUrlRef.current = null;
          }

          element.removeAttribute("src");
          element.load();
          resolve("played");
        };

        element.onerror = () => {
          cleanupListeners();
          setIsAssistantSpeaking(false);

          if (activeExactTtsObjectUrlRef.current === objectUrl) {
            URL.revokeObjectURL(objectUrl);
            activeExactTtsObjectUrlRef.current = null;
          }

          element.removeAttribute("src");
          element.load();
          reject(new Error("Voice audio playback failed."));
        };

        element.play().catch((playbackError) => {
          cleanupListeners();
          setIsAssistantSpeaking(false);

          if (activeExactTtsObjectUrlRef.current === objectUrl) {
            URL.revokeObjectURL(objectUrl);
            activeExactTtsObjectUrlRef.current = null;
          }

          element.removeAttribute("src");
          element.load();

          if (
            playbackError instanceof DOMException &&
            playbackError.name === "AbortError"
          ) {
            resolve("aborted");
            return;
          }

          console.warn("voice exact tts playback failed", playbackError);
          resolve("fallback");
        });
        controller.signal.addEventListener("abort", handleAbort, {
          once: true,
        });
      });
    },
    [ensureTtsAudioElement, voice],
  );

  const finishAgentTurn = useCallback(
    async (
      resumeListening = autoResumeListeningRef.current,
      resumeDelayMs = 0,
    ) => {
      clearSpeechTimeout();
      if (resumeListeningTimeoutRef.current) {
        clearTimeout(resumeListeningTimeoutRef.current);
        resumeListeningTimeoutRef.current = null;
      }

      turnLockedRef.current = false;
      autoResumeListeningRef.current = false;
      voiceTurnTtsStateRef.current = clearVoiceTurnTtsState();
      ttsRequestInFlightRef.current = false;
      cleanupExactTtsPlayback();
      activeTtsResponseKeyRef.current = null;
      lastHandledTtsResponseKeyRef.current = null;
      setIsSynthesizingSpeech(false);
      setIsAssistantSpeaking(false);

      if (resumeListening && isActiveRef.current) {
        const resumeListeningNow = () =>
          setListeningState({
            enabled: true,
            commitBuffer: false,
            releaseStream: false,
          })
            .then(() => {
              lastAutoResumeAtRef.current = Date.now();
            })
            .catch((resumeError) => {
              setError(
                resumeError instanceof Error
                  ? resumeError
                  : new Error(String(resumeError)),
              );
            });

        if (resumeDelayMs > 0) {
          resumeListeningTimeoutRef.current = setTimeout(() => {
            resumeListeningTimeoutRef.current = null;
            if (!isActiveRef.current) {
              return;
            }
            void resumeListeningNow();
          }, resumeDelayMs);
          return;
        }

        await resumeListeningNow();
      }
    },
    [clearSpeechTimeout, cleanupExactTtsPlayback, setListeningState],
  );

  const pumpVoiceTurnTts = useCallback(
    async (resumeDelayMs = 0) => {
      if (!transportRef.current) {
        await finishAgentTurn();
        return;
      }

      let nextState = voiceTurnTtsStateRef.current;
      if (nextState.inFlightChunk && ttsRequestInFlightRef.current) {
        syncSpeechActivityState();
        return;
      }
      if (!nextState.inFlightChunk) {
        nextState = shiftVoiceTurnTtsQueue(nextState);
        voiceTurnTtsStateRef.current = nextState;
      }

      const nextChunk = nextState.inFlightChunk?.trim();
      if (!nextChunk) {
        syncSpeechActivityState();
        if (shouldFinishVoiceTurnTts(nextState)) {
          await finishAgentTurn(autoResumeListeningRef.current, resumeDelayMs);
        }
        return;
      }

      clearSpeechTimeout();
      activeTtsResponseKeyRef.current = null;
      lastHandledTtsResponseKeyRef.current = null;
      lastAssistantSpeechRef.current = nextChunk;
      assistantEchoGuardUntilRef.current =
        Date.now() + estimateSpeechDurationMs(nextChunk);
      ttsRequestInFlightRef.current = true;
      setIsSynthesizingSpeech(true);
      speechTimeout.current = setTimeout(() => {
        void finishAgentTurn();
      }, VOICE_TTS_TIMEOUT_MS);

      if (exactTtsModeRef.current !== "realtime") {
        const exactTtsResult = await playExactSpeechChunk(nextChunk);

        if (exactTtsResult === "played") {
          exactTtsModeRef.current = "exact";
          clearSpeechTimeout();
          ttsRequestInFlightRef.current = false;
          voiceTurnTtsStateRef.current = completeVoiceTurnTtsChunk(
            voiceTurnTtsStateRef.current,
          );
          setIsAssistantSpeaking(false);
          syncSpeechActivityState();

          if (voiceTurnTtsStateRef.current.queue.length > 0) {
            await pumpVoiceTurnTts(resumeDelayMs);
            return;
          }

          if (shouldFinishVoiceTurnTts(voiceTurnTtsStateRef.current)) {
            await finishAgentTurn(
              autoResumeListeningRef.current,
              getPlaybackResumeDelayMs(),
            );
          }
          return;
        }

        if (exactTtsResult === "aborted") {
          return;
        }

        exactTtsModeRef.current = "realtime";
      }

      sendRealtimeEvent({
        type: "response.create",
        response: {
          conversation: "none",
          input: [],
          instructions: buildSpeechInstructions(nextChunk),
          output_modalities: ["audio"],
        },
      });
    },
    [
      clearSpeechTimeout,
      finishAgentTurn,
      getPlaybackResumeDelayMs,
      playExactSpeechChunk,
      sendRealtimeEvent,
      syncSpeechActivityState,
    ],
  );

  const handleVoiceTurnTtsChunkComplete = useCallback(
    async (resumeDelayMs = 0, responseKey?: string) => {
      clearSpeechTimeout();
      if (responseKey) {
        const shouldHandle = shouldHandleRealtimeTtsCompletion({
          eventKey: responseKey,
          activeKey: activeTtsResponseKeyRef.current,
          lastHandledKey: lastHandledTtsResponseKeyRef.current,
        });

        if (!shouldHandle) {
          return;
        }

        lastHandledTtsResponseKeyRef.current = responseKey;
      }

      activeTtsResponseKeyRef.current = null;
      ttsRequestInFlightRef.current = false;

      if (!voiceTurnTtsStateRef.current.inFlightChunk) {
        if (shouldFinishVoiceTurnTts(voiceTurnTtsStateRef.current)) {
          await finishAgentTurn(autoResumeListeningRef.current, resumeDelayMs);
        }
        return;
      }

      voiceTurnTtsStateRef.current = completeVoiceTurnTtsChunk(
        voiceTurnTtsStateRef.current,
      );
      setIsAssistantSpeaking(false);
      syncSpeechActivityState();

      if (voiceTurnTtsStateRef.current.queue.length > 0) {
        await pumpVoiceTurnTts(resumeDelayMs);
        return;
      }

      if (shouldFinishVoiceTurnTts(voiceTurnTtsStateRef.current)) {
        await finishAgentTurn(autoResumeListeningRef.current, resumeDelayMs);
      }
    },
    [
      clearSpeechTimeout,
      finishAgentTurn,
      pumpVoiceTurnTts,
      syncSpeechActivityState,
    ],
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
          threadId: threadIdRef.current,
          transcriptionLanguage: preferredVoiceLanguageRef.current,
          mentions: latestOptionsRef.current?.mentions,
          allowedMcpServers: latestOptionsRef.current?.allowedMcpServers,
          allowedAppDefaultToolkit:
            latestOptionsRef.current?.allowedAppDefaultToolkit,
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

  const legacyTransport = useMemo(
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
              responseLanguageHint: preferredVoiceLanguageRef.current,
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
    messages: legacyMessages,
    status: legacyStatus,
    sendMessage: sendLegacyMessage,
    setMessages: setLegacyMessages,
    addToolResult: legacyAddToolResult,
    stop: stopChatResponse,
    error: chatError,
  } = useChat<UIMessage>({
    id: threadId ?? "voice-chat-pending",
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    transport: legacyTransport,
    generateId: generateUUID,
    experimental_throttle: 32,
    onFinish: ({ messages: finishedMessages, isAbort }) => {
      if (sessionModeRef.current === "realtime_native") {
        return;
      }
      if (isAbort) {
        voiceTurnTtsStateRef.current = {
          ...voiceTurnTtsStateRef.current,
          queue: [],
          streamCompleted: true,
        };
        syncSpeechActivityState();
        if (!hasActiveVoiceTurnTtsWork(voiceTurnTtsStateRef.current)) {
          void finishAgentTurn();
        }
        return;
      }

      const currentThreadId = threadIdRef.current;
      if (currentThreadId) {
        const titleAction = resolveThreadTitleFinishAction({
          threadId: currentThreadId,
          messages: finishedMessages,
          threadList: appStore.getState().threadList,
        });

        if (titleAction.type === "generate") {
          generateTitle(titleAction.prompt);
        } else if (titleAction.type === "refresh-list") {
          mutate("/api/thread");
        }
      }
    },
  });
  const hasPendingToolCalls = useMemo(
    () =>
      sessionModeRef.current === "realtime_native"
        ? pendingToolCalls.length > 0
        : hasPendingVoiceToolCalls(legacyMessages),
    [legacyMessages, pendingToolCalls.length],
  );
  const shouldHoldSpeechForTools = useMemo(
    () =>
      sessionModeRef.current === "legacy" &&
      (hasPendingToolCalls ||
        lastAssistantMessageIsCompleteWithToolCalls({
          messages: legacyMessages,
        })),
    [hasPendingToolCalls, legacyMessages],
  );

  useEffect(() => {
    if (sessionModeRef.current !== "legacy" || !turnLockedRef.current) {
      return;
    }

    const assistantText = getLatestTurnAssistantSpeechText(legacyMessages);
    const nextState = deriveVoiceTurnTtsState({
      state: voiceTurnTtsStateRef.current,
      assistantText,
      shouldHoldForTools: shouldHoldSpeechForTools,
      isStreamFinished: legacyStatus === "ready",
    });

    voiceTurnTtsStateRef.current = nextState;
    syncSpeechActivityState();

    if (hasActiveVoiceTurnTtsWork(nextState)) {
      void pumpVoiceTurnTts();
      return;
    }

    if (
      legacyStatus === "ready" &&
      !shouldHoldSpeechForTools &&
      (shouldFinishVoiceTurnTts(nextState) || !assistantText)
    ) {
      void finishAgentTurn(autoResumeListeningRef.current);
    }
  }, [
    finishAgentTurn,
    legacyMessages,
    legacyStatus,
    pumpVoiceTurnTts,
    shouldHoldSpeechForTools,
    syncSpeechActivityState,
  ]);
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
      lastAutoResumeAtRef.current = 0;
      autoResumeListeningRef.current = isListeningRef.current;
      clearSpeechTimeout();
      voiceTurnTtsStateRef.current = clearVoiceTurnTtsState();
      ttsRequestInFlightRef.current = false;
      activeTtsResponseKeyRef.current = null;
      lastHandledTtsResponseKeyRef.current = null;
      setIsSynthesizingSpeech(false);
      setIsAssistantSpeaking(false);
      setError(null);

      await setListeningState({
        enabled: false,
        commitBuffer: false,
        releaseStream: false,
      });

      await Promise.resolve(
        sendLegacyMessage({
          role: "user",
          parts: [{ type: "text", text: userText }],
        }),
      ).catch(async (sendError) => {
        setError(
          sendError instanceof Error ? sendError : new Error(String(sendError)),
        );
        await finishAgentTurn(false);
      });
      setLiveInputTranscript("");
    },
    [clearSpeechTimeout, finishAgentTurn, sendLegacyMessage, setListeningState],
  );

  const shouldIgnoreTranscript = useCallback((transcript: string) => {
    const expectedLanguage = preferredVoiceLanguageRef.current;

    if (
      expectedLanguage &&
      !isTranscriptCompatibleWithLanguage(transcript, expectedLanguage)
    ) {
      return true;
    }

    const speechDurationMs = speechStartedAtRef.current
      ? Date.now() - speechStartedAtRef.current
      : Number.POSITIVE_INFINITY;
    const recentlyResumedListening =
      listeningEnabledAtRef.current > 0 &&
      Date.now() - listeningEnabledAtRef.current <=
        VOICE_SHORT_TRANSCRIPT_GRACE_MS;
    const recentlyAutoResumedAfterAssistant =
      lastAutoResumeAtRef.current > 0 &&
      Date.now() - lastAutoResumeAtRef.current <=
        VOICE_AUTO_RESUME_TRANSCRIPT_GRACE_MS;

    if (
      recentlyResumedListening &&
      speechDurationMs <= VOICE_SHORT_TRANSCRIPT_MAX_DURATION_MS &&
      isLikelyGhostTranscript(transcript, {
        maxChars: VOICE_SHORT_TRANSCRIPT_MAX_CHARS,
        maxWords: VOICE_SHORT_TRANSCRIPT_MAX_WORDS,
      })
    ) {
      return true;
    }

    if (
      recentlyAutoResumedAfterAssistant &&
      isLikelyEchoTranscript(transcript, lastAssistantSpeechRef.current)
    ) {
      return true;
    }

    if (
      recentlyAutoResumedAfterAssistant &&
      shouldIgnoreShortAutoResumeTranscript({
        transcript,
        assistantText: lastAssistantSpeechRef.current,
        speechDurationMs,
      })
    ) {
      return true;
    }

    return false;
  }, []);

  const interruptActiveSpeech = useCallback(
    (reason: string) => {
      if (sessionModeRef.current !== "realtime_native") {
        return;
      }

      queuedClientResponseKindsRef.current = [];
      currentResponseKindRef.current = null;
      sendRealtimeEvent({ type: "response.cancel" });
      sendRealtimeEvent({ type: "output_audio_buffer.clear" });

      if (lastAssistantItemIdRef.current) {
        sendRealtimeEvent({
          type: "conversation.item.truncate",
          item_id: lastAssistantItemIdRef.current,
          content_index: 0,
          audio_end_ms: Math.max(
            0,
            assistantPlaybackStartedAtRef.current
              ? Date.now() - assistantPlaybackStartedAtRef.current
              : 0,
          ),
        });
      }

      audioElement.current?.pause();
      assistantPlaybackStartedAtRef.current = null;
      fillerResponseIdRef.current = null;
      setIsAssistantSpeaking(false);
      setIsSynthesizingSpeech(false);
      activeResponseIdRef.current = null;
      setActiveResponseId(null);
      setPhase(isListeningRef.current ? "ready" : "muted");
      pushTimeline("barge_in", { reason });
    },
    [pushTimeline, sendRealtimeEvent],
  );

  const cancelToolFiller = useCallback(() => {
    if (fillerResponseIdRef.current) {
      sendRealtimeEvent({ type: "response.cancel" });
      sendRealtimeEvent({ type: "output_audio_buffer.clear" });
      fillerResponseIdRef.current = null;
      if (currentResponseKindRef.current?.kind === "filler") {
        currentResponseKindRef.current = null;
      }
    }
  }, [sendRealtimeEvent]);

  const requestToolProgress = useCallback(
    (input: {
      toolName: string;
      callId: string;
      stage: VoiceFillerStage;
    }) => {
      const { toolName, callId, stage } = input;
      const metadata = voiceToolsByNameRef.current[toolName];
      if (!metadata || metadata.preferSilentExecution) {
        return;
      }

      const toolRun = pendingToolCallsRef.current.find(
        (tool) => tool.callId === callId && tool.status === "running",
      );

      if (!toolRun) {
        clearToolProgressTimers(callId);
        return;
      }

      if (
        assistantPlaybackStartedAtRef.current ||
        fillerResponseIdRef.current
      ) {
        pushTimeline("tool_progress_skipped", {
          toolName,
          callId,
          stage,
          reason: "audio_in_flight",
        });
        return;
      }

      const elapsedMs = Date.now() - toolRun.startedAt;
      queuedClientResponseKindsRef.current.push({
        kind: "filler",
        callId,
        toolName,
        stage,
      });
      sendRealtimeEvent({
        type: "response.create",
        response: {
          conversation: "none",
          input: [],
          instructions: buildVoiceFillerInstructions(metadata, {
            stage,
            seed: `${callId}:${stage}`,
          }),
          output_modalities: ["audio"],
        },
      });
      pushTimeline("tool_progress_requested", {
        toolName,
        callId,
        stage,
        elapsedMs,
      });
    },
    [clearToolProgressTimers, pushTimeline, sendRealtimeEvent],
  );

  const scheduleToolProgress = useCallback(
    (toolName: string, callId: string) => {
      clearToolProgressTimers(callId);

      const stages: Array<{
        stage: VoiceFillerStage;
        delayMs: number;
      }> = [
        {
          stage: "ack",
          delayMs: fillerDelayMsRef.current,
        },
        {
          stage: "progress",
          delayMs: Math.max(
            progressDelayMsRef.current,
            fillerDelayMsRef.current,
          ),
        },
        {
          stage: "long-progress",
          delayMs: Math.max(
            longProgressDelayMsRef.current,
            progressDelayMsRef.current,
          ),
        },
      ];

      const timeouts = stages.map(({ stage, delayMs }) =>
        setTimeout(() => {
          requestToolProgress({
            toolName,
            callId,
            stage,
          });
        }, delayMs),
      );

      toolProgressTimeoutsRef.current.set(callId, timeouts);
    },
    [clearToolProgressTimers, requestToolProgress],
  );

  const executeNativeToolCall = useCallback(
    async (event: {
      itemId: string;
      toolName: string;
      callId: string;
      args: unknown;
    }) => {
      if (
        pendingToolCallsRef.current.some((tool) => tool.callId === event.callId)
      ) {
        return;
      }

      const toolStartedAt = Date.now();

      replaceNativeMessages((current) =>
        upsertRealtimeToolPart({
          messages: current,
          part: {
            messageId: event.itemId,
            toolName: event.toolName,
            toolCallId: event.callId,
            input: event.args,
            state: "input-available",
          },
        }),
      );
      setPendingToolCallsState((current) => [
        ...current.filter((tool) => tool.callId !== event.callId),
        {
          callId: event.callId,
          toolName: event.toolName,
          startedAt: toolStartedAt,
          status: "running",
        },
      ]);
      setPhase("tool-call");
      pushTimeline("tool_started", {
        toolName: event.toolName,
        callId: event.callId,
      });
      scheduleToolProgress(event.toolName, event.callId);

      try {
        const response = await fetch("/api/voice/tool-exec", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sessionId: sessionIdRef.current ?? threadIdRef.current,
            callId: event.callId,
            toolName: event.toolName,
            args: event.args,
            threadId: threadIdRef.current,
            agentId: latestOptionsRef.current?.agentId,
            mentions: latestOptionsRef.current?.mentions,
            allowedMcpServers: latestOptionsRef.current?.allowedMcpServers,
            allowedAppDefaultToolkit:
              latestOptionsRef.current?.allowedAppDefaultToolkit,
          }),
        });
        const payload = await response.json();

        clearToolProgressTimers(event.callId);
        cancelToolFiller();

        replaceNativeMessages((current) =>
          upsertRealtimeToolPart({
            messages: current,
            part: {
              messageId: event.itemId,
              toolName: event.toolName,
              toolCallId: event.callId,
              input: event.args,
              state:
                response.ok && payload.ok ? "output-available" : "output-error",
              output: payload.output,
            },
          }),
        );
        setPendingToolCallsState((current) =>
          current.map((tool) =>
            tool.callId === event.callId
              ? {
                  ...tool,
                  status: response.ok && payload.ok ? "completed" : "failed",
                }
              : tool,
          ),
        );
        pushTimeline("tool_finished", {
          toolName: event.toolName,
          callId: event.callId,
          ok: response.ok && payload.ok,
          durationMs: Date.now() - toolStartedAt,
        });

        sendRealtimeEvent({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: event.callId,
            output: JSON.stringify({
              output: payload.output,
              spokenSummary: payload.spokenSummary,
              tool: payload.tool,
            }),
          },
        });
        queuedClientResponseKindsRef.current.push({
          kind: "tool-resume",
          callId: event.callId,
          toolName: event.toolName,
        });
        lastToolResumeRequestedAtRef.current = {
          callId: event.callId,
          toolName: event.toolName,
          at: Date.now(),
        };
        pushTimeline("tool_resume_requested", {
          toolName: event.toolName,
          callId: event.callId,
        });
        sendRealtimeEvent({
          type: "response.create",
          response: {
            instructions: buildVoiceToolResumeInstructions({
              ok: response.ok && payload.ok,
              spokenSummary: payload.spokenSummary,
              tool: payload.tool,
            }),
            output_modalities: ["audio"],
          },
        });
      } catch (toolError) {
        const errorOutput = {
          isError: true,
          error:
            toolError instanceof Error ? toolError.message : String(toolError),
        };

        clearToolProgressTimers(event.callId);
        cancelToolFiller();
        replaceNativeMessages((current) =>
          upsertRealtimeToolPart({
            messages: current,
            part: {
              messageId: event.itemId,
              toolName: event.toolName,
              toolCallId: event.callId,
              input: event.args,
              state: "output-error",
              output: errorOutput,
            },
          }),
        );
        setPendingToolCallsState((current) =>
          current.map((tool) =>
            tool.callId === event.callId
              ? {
                  ...tool,
                  status: "failed",
                }
              : tool,
          ),
        );
        pushTimeline("tool_finished", {
          toolName: event.toolName,
          callId: event.callId,
          ok: false,
          durationMs: Date.now() - toolStartedAt,
        });

        sendRealtimeEvent({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: event.callId,
            output: JSON.stringify({
              output: errorOutput,
              spokenSummary: null,
              tool: voiceToolsByNameRef.current[event.toolName] ?? null,
            }),
          },
        });
        queuedClientResponseKindsRef.current.push({
          kind: "tool-resume",
          callId: event.callId,
          toolName: event.toolName,
        });
        lastToolResumeRequestedAtRef.current = {
          callId: event.callId,
          toolName: event.toolName,
          at: Date.now(),
        };
        pushTimeline("tool_resume_requested", {
          toolName: event.toolName,
          callId: event.callId,
          ok: false,
        });
        sendRealtimeEvent({
          type: "response.create",
          response: {
            instructions: buildVoiceToolResumeInstructions({
              ok: false,
              spokenSummary: null,
              tool: voiceToolsByNameRef.current[event.toolName] ?? null,
            }),
            output_modalities: ["audio"],
          },
        });
      }
    },
    [
      clearToolProgressTimers,
      cancelToolFiller,
      pushTimeline,
      replaceNativeMessages,
      scheduleToolProgress,
      sendRealtimeEvent,
      setPendingToolCallsState,
    ],
  );

  const handleNativeServerEvent = useCallback(
    (event: OpenAIRealtimeServerEvent) => {
      switch (event.type) {
        case "response.created": {
          const queuedKind = queuedClientResponseKindsRef.current.shift();
          const resolvedResponseKind = queuedKind ?? { kind: "model" as const };
          currentResponseKindRef.current = resolvedResponseKind;

          if (resolvedResponseKind.kind === "filler") {
            fillerResponseIdRef.current = event.response.id;
            pushTimeline("response_created", {
              responseId: event.response.id,
              kind: "filler",
              toolName: resolvedResponseKind.toolName,
              callId: resolvedResponseKind.callId,
              stage: resolvedResponseKind.stage,
            });
            break;
          }

          activeResponseIdRef.current = event.response.id;
          setActiveResponseId(event.response.id);
          setPhase("thinking");
          pushTimeline("response_created", {
            responseId: event.response.id,
            kind: resolvedResponseKind.kind,
            ...(resolvedResponseKind.kind === "tool-resume"
              ? {
                  toolName: resolvedResponseKind.toolName,
                  callId: resolvedResponseKind.callId,
                }
              : {}),
            ...(resolvedResponseKind.kind === "model" &&
            lastUserTranscriptCompletedAtRef.current
              ? {
                  latencyMs:
                    Date.now() - lastUserTranscriptCompletedAtRef.current,
                }
              : {}),
          });
          break;
        }
        case "input_audio_buffer.speech_started": {
          speechStartedAtRef.current = Date.now();
          setIsUserSpeaking(true);
          setLiveInputTranscript("");
          setPhase("listening");
          if (
            assistantPlaybackStartedAtRef.current ||
            fillerResponseIdRef.current
          ) {
            interruptActiveSpeech("user_speech_started");
          }
          break;
        }
        case "conversation.item.input_audio_transcription.delta": {
          setLiveInputTranscript((current) => `${current}${event.delta}`);
          break;
        }
        case "conversation.item.input_audio_transcription.completed": {
          setIsUserSpeaking(false);
          speechStartedAtRef.current = null;
          const transcript = event.transcript?.trim();
          if (!transcript) {
            setLiveInputTranscript("");
            break;
          }

          if (shouldIgnoreTranscript(transcript)) {
            setLiveInputTranscript("");
            break;
          }

          replaceNativeMessages((current) => [
            ...current.filter((message) => message.id !== event.item_id),
            {
              id: event.item_id,
              role: "user",
              parts: [{ type: "text", text: transcript }],
            },
          ]);
          lastUserTranscriptCompletedAtRef.current = Date.now();
          setLiveInputTranscript("");
          setPhase("thinking");
          pushTimeline("user_transcript_final", {
            itemId: event.item_id,
            transcript,
          });
          break;
        }
        case "response.output_audio.delta":
        case "response.audio.delta": {
          playWebSocketAudioDelta(event.delta).catch((playbackError) => {
            console.error("voice websocket playback error", playbackError);
          });
          break;
        }
        case "output_audio_buffer.started": {
          const responseKind = currentResponseKindRef.current;
          const now = Date.now();
          assistantPlaybackStartedAtRef.current = now;
          setIsAssistantSpeaking(true);
          setIsSynthesizingSpeech(false);
          setPhase("speaking");
          if (
            responseKind?.kind === "model" &&
            lastUserTranscriptCompletedAtRef.current
          ) {
            pushTimeline("assistant_audio_started", {
              source: "user_turn",
              latencyMs: now - lastUserTranscriptCompletedAtRef.current,
            });
          } else if (
            responseKind?.kind === "tool-resume" &&
            lastToolResumeRequestedAtRef.current?.callId === responseKind.callId
          ) {
            pushTimeline("assistant_audio_started", {
              source: "tool_resume",
              toolName: responseKind.toolName,
              callId: responseKind.callId,
              latencyMs: now - lastToolResumeRequestedAtRef.current.at,
            });
          } else if (responseKind?.kind === "filler") {
            const runningTool = pendingToolCallsRef.current.find(
              (tool) => tool.callId === responseKind.callId,
            );
            pushTimeline("assistant_audio_started", {
              source: "tool_progress",
              toolName: responseKind.toolName,
              callId: responseKind.callId,
              stage: responseKind.stage,
              ...(runningTool
                ? {
                    latencyMs: now - runningTool.startedAt,
                  }
                : {}),
            });
          }
          resumeAudioElementPlayback().catch(() => {});
          break;
        }
        case "response.output_audio.done":
        case "response.audio.done":
        case "output_audio_buffer.stopped": {
          if (currentResponseKindRef.current) {
            pushTimeline("assistant_audio_completed", {
              source: currentResponseKindRef.current.kind,
              ...(currentResponseKindRef.current.kind === "filler"
                ? {
                    stage: currentResponseKindRef.current.stage,
                    callId: currentResponseKindRef.current.callId,
                    toolName: currentResponseKindRef.current.toolName,
                  }
                : currentResponseKindRef.current.kind === "tool-resume"
                  ? {
                      callId: currentResponseKindRef.current.callId,
                      toolName: currentResponseKindRef.current.toolName,
                    }
                  : {}),
            });
          }
          assistantPlaybackStartedAtRef.current = null;
          setIsAssistantSpeaking(false);
          if (pendingToolCallsRef.current.length > 0) {
            setPhase("tool-call");
          } else {
            setPhase(isListeningRef.current ? "ready" : "muted");
          }
          break;
        }
        case "response.output_audio_transcript.delta":
        case "response.output_text.delta": {
          replaceNativeMessages((current) =>
            appendOrReplaceRealtimeMessageText({
              messages: current,
              messageId: event.item_id,
              role: "assistant",
              text: event.delta,
              append: true,
            }),
          );
          break;
        }
        case "response.output_audio_transcript.done":
        case "response.output_text.done": {
          replaceNativeMessages((current) =>
            appendOrReplaceRealtimeMessageText({
              messages: current,
              messageId: event.item_id,
              role: "assistant",
              text: event.transcript,
              append: false,
            }),
          );
          lastAssistantItemIdRef.current = event.item_id;
          setLastAssistantItemId(event.item_id);
          pushTimeline("assistant_text_final", { itemId: event.item_id });
          break;
        }
        case "response.function_call_arguments.done":
        case "response.mcp_call_arguments.done": {
          void executeNativeToolCall({
            itemId: event.item_id,
            toolName: event.name,
            callId: event.call_id,
            args: parseRealtimeToolArguments(event.arguments),
          });
          break;
        }
        case "response.output_item.done": {
          if (event.item.role === "assistant" && event.item.id) {
            lastAssistantItemIdRef.current = event.item.id;
            setLastAssistantItemId(event.item.id);
          }

          if (
            event.item.type === "function_call" &&
            event.item.call_id &&
            event.item.name
          ) {
            void executeNativeToolCall({
              itemId: event.item.id,
              toolName: event.item.name,
              callId: event.item.call_id,
              args: parseRealtimeToolArguments(event.item.arguments),
            });
          }
          break;
        }
        case "input_audio_buffer.speech_stopped": {
          setIsUserSpeaking(false);
          break;
        }
        case "response.done": {
          if (event.response.id === fillerResponseIdRef.current) {
            fillerResponseIdRef.current = null;
            if (currentResponseKindRef.current?.kind === "filler") {
              currentResponseKindRef.current = null;
            }
            break;
          }

          let nextPending = pendingToolCallsRef.current;
          activeResponseIdRef.current = null;
          currentResponseKindRef.current = null;
          setActiveResponseId(null);
          setPendingToolCallsState((current) => {
            nextPending = current.filter((tool) => tool.status === "running");
            return nextPending;
          });
          setPhase(
            nextPending.some((tool) => tool.status === "running")
              ? "tool-call"
              : isListeningRef.current
                ? "ready"
                : "muted",
          );
          void persistLatestNativeTurn();
          break;
        }
        case "session.error":
        case "error":
        case "invalid_request_error": {
          setPhase("error");
          setError(new Error(event.error.message));
          break;
        }
      }
    },
    [
      cancelToolFiller,
      executeNativeToolCall,
      interruptActiveSpeech,
      persistLatestNativeTurn,
      playWebSocketAudioDelta,
      pushTimeline,
      replaceNativeMessages,
      resumeAudioElementPlayback,
      setPendingToolCallsState,
      shouldIgnoreTranscript,
    ],
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
      if (sessionModeRef.current === "realtime_native") {
        handleNativeServerEvent(event);
        return;
      }

      switch (event.type) {
        case "input_audio_buffer.speech_started": {
          speechStartedAtRef.current = Date.now();
          if (!turnLockedRef.current) {
            setIsUserSpeaking(true);
            setLiveInputTranscript("");
          }
          break;
        }
        case "conversation.item.input_audio_transcription.delta": {
          if (!turnLockedRef.current) {
            setLiveInputTranscript((current) => `${current}${event.delta}`);
          }
          break;
        }
        case "conversation.item.input_audio_transcription.completed": {
          setIsUserSpeaking(false);
          const transcript = event.transcript?.trim();
          speechStartedAtRef.current = null;
          if (transcript) {
            if (shouldIgnoreTranscript(transcript)) {
              setLiveInputTranscript("");
              break;
            }
            if (
              Date.now() <= assistantEchoGuardUntilRef.current &&
              isLikelyEchoTranscript(transcript, lastAssistantSpeechRef.current)
            ) {
              setLiveInputTranscript("");
              break;
            }
            void sendVoiceTurn(transcript);
          }
          break;
        }
        case "response.audio.delta":
        case "response.output_audio.delta": {
          if (
            voiceTurnTtsStateRef.current.inFlightChunk &&
            !activeTtsResponseKeyRef.current
          ) {
            activeTtsResponseKeyRef.current = buildRealtimeResponseKey({
              responseId: event.response_id,
              itemId: event.item_id,
            });
          }
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
        case "response.output_audio.done": {
          void handleVoiceTurnTtsChunkComplete(
            getPlaybackResumeDelayMs(),
            buildRealtimeResponseKey({
              responseId: event.response_id,
              itemId: event.item_id,
            }),
          );
          break;
        }
        case "output_audio_buffer.stopped": {
          setIsAssistantSpeaking(false);
          break;
        }
        case "input_audio_buffer.speech_stopped": {
          setIsUserSpeaking(false);
          break;
        }
        case "response.done": {
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
      getPlaybackResumeDelayMs,
      handleNativeServerEvent,
      handleVoiceTurnTtsChunkComplete,
      playWebSocketAudioDelta,
      sendVoiceTurn,
      shouldIgnoreTranscript,
    ],
  );

  const startWebSocketFallback = useCallback(
    async (session: OpenAIRealtimeSession) => {
      const websocketEndpointUrl = session.websocketEndpointUrl;

      if (fallbackAttemptedRef.current || !websocketEndpointUrl) {
        throw new Error("Voice WebSocket fallback is not available.");
      }

      fallbackAttemptedRef.current = true;
      setTransportState("websocket");
      setPhase("connecting");

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
        const socket = new WebSocket(websocketEndpointUrl);
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
            setPhase("ready");
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
          setPhase("error");
          reject(new Error("Voice WebSocket connection failed."));
        });

        socket.addEventListener("close", () => {
          webSocket.current = null;
          void stopWebSocketAudioCapture();
          setTransportState(null);
          clearSpeechTimeout();
          voiceTurnTtsStateRef.current = clearVoiceTurnTtsState();
          ttsRequestInFlightRef.current = false;
          cleanupExactTtsPlayback();
          activeTtsResponseKeyRef.current = null;
          lastHandledTtsResponseKeyRef.current = null;
          setIsActive(false);
          isActiveRef.current = false;
          isListeningRef.current = false;
          setIsListening(false);
          setIsSessionLoading(false);
          setPhase("idle");
          setIsSynthesizingSpeech(false);
          setIsAssistantSpeaking(false);
        });
      });
    },
    [
      clearSpeechTimeout,
      ensureAudioStream,
      handleServerEvent,
      setTransportState,
      startWebSocketAudioCapture,
      cleanupExactTtsPlayback,
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
    setPhase("connecting");
    setTransportState(null);
    setLegacyMessages([]);
    clearNativeConversationState(true);
    sessionIdRef.current = threadIdRef.current;
    realtimeModelRef.current = null;
    voiceToolsByNameRef.current = {};
    queuedClientResponseKindsRef.current = [];
    currentResponseKindRef.current = null;
    fillerResponseIdRef.current = null;
    assistantPlaybackStartedAtRef.current = null;
    lastUserTranscriptCompletedAtRef.current = null;
    lastToolResumeRequestedAtRef.current = null;
    lastPersistedAssistantMessageIdRef.current = null;
    clearToolProgressTimers();
    clearSpeechTimeout();
    voiceTurnTtsStateRef.current = clearVoiceTurnTtsState();
    ttsRequestInFlightRef.current = false;
    cleanupExactTtsPlayback();
    exactTtsModeRef.current = "auto";
    activeTtsResponseKeyRef.current = null;
    lastHandledTtsResponseKeyRef.current = null;
    setIsSynthesizingSpeech(false);
    setIsAssistantSpeaking(false);

    try {
      fallbackAttemptedRef.current = false;
      setSessionModeState(voiceMode);
      webSocket.current?.close();
      webSocket.current = null;
      const session = await createSession();
      const resolvedSessionMode = session.voiceMode ?? voiceMode;
      setSessionModeState(resolvedSessionMode);
      sessionIdRef.current = session.id ?? threadIdRef.current;
      realtimeModelRef.current = session.model ?? null;
      fillerDelayMsRef.current = session.voicePolicy?.fillerDelayMs ?? 200;
      progressDelayMsRef.current =
        session.voicePolicy?.progressDelayMs ?? 1_800;
      longProgressDelayMsRef.current =
        session.voicePolicy?.longProgressDelayMs ?? 4_500;
      voiceToolsByNameRef.current = Object.fromEntries(
        (session.voiceTools ?? []).map((tool) => [tool.name, tool]),
      );
      pushTimeline("session_created", {
        mode: resolvedSessionMode,
        model: session.model ?? null,
      });
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
              setPhase("error");
              setError(
                fallbackError instanceof Error
                  ? fallbackError
                  : new Error(String(fallbackError)),
              );
            });
            return;
          }
          setIsSessionLoading(false);
          setTransportState(null);
          if (state !== "closed") {
            setPhase("error");
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
          setTransportState(null);
          setPhase("error");
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
        setTransportState("webrtc");
        setPhase("ready");
      });
      dc.addEventListener("close", () => {
        if (transportRef.current === "websocket") {
          return;
        }
        if (connectTimeout.current) {
          clearTimeout(connectTimeout.current);
          connectTimeout.current = null;
        }
        setTransportState(null);
        clearSpeechTimeout();
        voiceTurnTtsStateRef.current = clearVoiceTurnTtsState();
        ttsRequestInFlightRef.current = false;
        cleanupExactTtsPlayback();
        activeTtsResponseKeyRef.current = null;
        lastHandledTtsResponseKeyRef.current = null;
        setIsActive(false);
        isActiveRef.current = false;
        setIsListening(false);
        isListeningRef.current = false;
        setIsSessionLoading(false);
        setPhase("idle");
        setIsSynthesizingSpeech(false);
        setIsAssistantSpeaking(false);
      });
      dc.addEventListener("error", (errorEvent) => {
        if (transportRef.current === "websocket") {
          return;
        }
        if (connectTimeout.current) {
          clearTimeout(connectTimeout.current);
          connectTimeout.current = null;
        }
        clearSpeechTimeout();
        voiceTurnTtsStateRef.current = clearVoiceTurnTtsState();
        ttsRequestInFlightRef.current = false;
        cleanupExactTtsPlayback();
        activeTtsResponseKeyRef.current = null;
        lastHandledTtsResponseKeyRef.current = null;
        setError(
          errorEvent instanceof Error
            ? errorEvent
            : new Error(String(errorEvent)),
        );
        setTransportState(null);
        setPhase("error");
        setIsActive(false);
        isActiveRef.current = false;
        setIsListening(false);
        isListeningRef.current = false;
        setIsSessionLoading(false);
        setIsSynthesizingSpeech(false);
        setIsAssistantSpeaking(false);
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
      setTransportState("webrtc");

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
                  setPhase("error");
                  setIsSessionLoading(false);
                });
                return;
              }

              setTransportState(null);
              setPhase("error");
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
                  setPhase("error");
                  setIsSessionLoading(false);
                });
                return;
              }
              setTransportState(null);
              setPhase("error");
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
      setTransportState(null);
      setPhase("error");
      setIsActive(false);
      isActiveRef.current = false;
      setIsListening(false);
      isListeningRef.current = false;
      setIsSessionLoading(false);
    }
  }, [
    clearToolProgressTimers,
    clearNativeConversationState,
    clearSpeechTimeout,
    cleanupExactTtsPlayback,
    createSession,
    ensureAudioElement,
    ensureAudioStream,
    handleServerEvent,
    isActive,
    isSessionLoading,
    pushTimeline,
    resumeAudioElementPlayback,
    setLegacyMessages,
    setSessionModeState,
    setTransportState,
    startWebSocketFallback,
    waitForIceGatheringComplete,
    voiceMode,
  ]);

  const startListening = useCallback(async () => {
    if (!isActiveRef.current || isSessionLoading || isListeningRef.current) {
      return;
    }

    if (
      sessionModeRef.current === "legacy" &&
      (turnLockedRef.current ||
        isSynthesizingSpeech ||
        legacyStatus !== "ready")
    ) {
      return;
    }

    try {
      autoResumeListeningRef.current = false;
      lastAutoResumeAtRef.current = 0;
      await setListeningState({
        enabled: true,
        commitBuffer: false,
        releaseStream: false,
      });
      if (sessionModeRef.current === "realtime_native") {
        setPhase("ready");
      }
    } catch (listenError) {
      setError(
        listenError instanceof Error
          ? listenError
          : new Error(String(listenError)),
      );
    }
  }, [isSessionLoading, isSynthesizingSpeech, legacyStatus, setListeningState]);

  const stopListening = useCallback(async () => {
    if (!isActiveRef.current || !isListeningRef.current) {
      return;
    }

    try {
      autoResumeListeningRef.current = false;
      lastAutoResumeAtRef.current = 0;
      await setListeningState({
        enabled: false,
        commitBuffer: true,
        releaseStream: true,
      });
      if (sessionModeRef.current === "realtime_native") {
        setPhase("muted");
      }
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
      clearToolProgressTimers();
      queuedClientResponseKindsRef.current = [];
      currentResponseKindRef.current = null;
      fillerResponseIdRef.current = null;
      if (speechTimeout.current) {
        clearTimeout(speechTimeout.current);
        speechTimeout.current = null;
      }
      clearSpeechTimeout();
      if (resumeListeningTimeoutRef.current) {
        clearTimeout(resumeListeningTimeoutRef.current);
        resumeListeningTimeoutRef.current = null;
      }
      stopChatResponse();
      sendRealtimeEvent({ type: "response.cancel" });
      sendRealtimeEvent({ type: "output_audio_buffer.clear" });
      await flushSessionEvents().catch(() => {});
      setTransportState(null);
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
      voiceTurnTtsStateRef.current = clearVoiceTurnTtsState();
      ttsRequestInFlightRef.current = false;
      cleanupExactTtsPlayback();
      exactTtsModeRef.current = "auto";
      activeTtsResponseKeyRef.current = null;
      lastHandledTtsResponseKeyRef.current = null;
      speechStartedAtRef.current = null;
      assistantPlaybackStartedAtRef.current = null;
      lastAutoResumeAtRef.current = 0;
      listeningEnabledAtRef.current = 0;
      sessionIdRef.current = null;
      realtimeModelRef.current = null;
      voiceToolsByNameRef.current = {};
      lastUserTranscriptCompletedAtRef.current = null;
      lastToolResumeRequestedAtRef.current = null;
      lastPersistedAssistantMessageIdRef.current = null;
      clearNativeConversationState(true);
      setLegacyMessages([]);
      setSessionModeState(voiceMode);
      setIsActive(false);
      isActiveRef.current = false;
      setIsListening(false);
      isListeningRef.current = false;
      setIsSessionLoading(false);
      setIsSynthesizingSpeech(false);
      setIsAssistantSpeaking(false);
      setIsUserSpeaking(false);
      setLiveInputTranscript("");
      setPhase("idle");
    } catch (stopError) {
      setError(
        stopError instanceof Error ? stopError : new Error(String(stopError)),
      );
    }
  }, [
    clearToolProgressTimers,
    clearNativeConversationState,
    flushSessionEvents,
    sendRealtimeEvent,
    setLegacyMessages,
    setSessionModeState,
    setTransportState,
    cleanupExactTtsPlayback,
    clearSpeechTimeout,
    stopChatResponse,
    stopWebSocketAudioCapture,
    voiceMode,
  ]);

  useEffect(() => {
    if (!chatError || sessionModeRef.current === "realtime_native") {
      return;
    }
    setPhase("error");
    setError(
      chatError instanceof Error ? chatError : new Error(String(chatError)),
    );
    void finishAgentTurn(false);
  }, [chatError, finishAgentTurn]);

  useEffect(() => {
    setLegacyMessages([]);
    clearNativeConversationState(true);
    voiceTurnTtsStateRef.current = clearVoiceTurnTtsState();
    clearSpeechTimeout();
    ttsRequestInFlightRef.current = false;
    cleanupExactTtsPlayback();
    exactTtsModeRef.current = "auto";
    activeTtsResponseKeyRef.current = null;
    lastHandledTtsResponseKeyRef.current = null;
    setIsSynthesizingSpeech(false);
    setIsAssistantSpeaking(false);
    sessionIdRef.current = null;
    realtimeModelRef.current = null;
    voiceToolsByNameRef.current = {};
    queuedClientResponseKindsRef.current = [];
    currentResponseKindRef.current = null;
    fillerResponseIdRef.current = null;
    lastUserTranscriptCompletedAtRef.current = null;
    lastToolResumeRequestedAtRef.current = null;
    lastPersistedAssistantMessageIdRef.current = null;
    if (!threadId && !isActiveRef.current) {
      setTransportState(null);
      setPhase("idle");
      setSessionModeState(voiceMode);
    }

    if (!threadId) {
      setLegacyMessages([]);
      return;
    }

    setLegacyMessages([]);
  }, [
    cleanupExactTtsPlayback,
    clearNativeConversationState,
    clearSpeechTimeout,
    setLegacyMessages,
    setSessionModeState,
    setTransportState,
    threadId,
    voiceMode,
  ]);

  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  const messages =
    sessionMode === "realtime_native" ? nativeMessages : legacyMessages;
  const addToolResult =
    sessionMode === "legacy" ? legacyAddToolResult : undefined;
  const isProcessingTurn =
    sessionMode === "realtime_native"
      ? phase === "thinking" ||
        phase === "tool-call" ||
        isSynthesizingSpeech ||
        pendingToolCalls.length > 0
      : legacyStatus === "submitted" ||
        legacyStatus === "streaming" ||
        isSynthesizingSpeech ||
        hasPendingVoiceToolCalls(legacyMessages);

  return {
    isActive,
    isUserSpeaking,
    isAssistantSpeaking,
    isListening,
    isLoading: isSessionLoading,
    isProcessingTurn,
    phase,
    transport,
    activeResponseId,
    lastAssistantItemId,
    pendingToolCalls,
    timeline,
    liveInputTranscript,
    error,
    messages,
    addToolResult,
    start,
    stop,
    startListening,
    stopListening,
  };
}
