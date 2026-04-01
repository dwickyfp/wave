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
  const audioElement = useRef<HTMLAudioElement | null>(null);
  const audioStream = useRef<MediaStream | null>(null);
  const connectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { setTheme } = useTheme();
  const tracks = useRef<RTCRtpSender[]>([]);

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

  const startListening = useCallback(async () => {
    try {
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
      if (tracks.current.length) {
        const micTrack = audioStream.current.getAudioTracks()[0];
        tracks.current.forEach((sender) => {
          sender.replaceTrack(micTrack);
        });
      }
      setIsListening(true);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

  const stopListening = useCallback(async () => {
    try {
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
      setIsListening(false);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

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
      dataChannel.current?.send(JSON.stringify(event));

      dataChannel.current?.send(JSON.stringify({ type: "response.create" }));
      dataChannel.current?.send(JSON.stringify({ type: "response.create" }));
    },
    [updateUIMessage],
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
    [clientFunctionCall, updateUIMessage],
  );

  const start = useCallback(async () => {
    if (isActive || isLoading) return;
    setIsLoading(true);
    setError(null);
    setMessages([]);
    try {
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
      connectTimeout.current = setTimeout(() => {
        if (
          dataChannel.current?.readyState !== "open" &&
          pc.connectionState !== "connected"
        ) {
          setError(
            new Error(
              "Voice connection timed out while waiting for the realtime data channel.",
            ),
          );
          setIsLoading(false);
        }
      }, 15000);
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
    voice,
    waitForIceGatheringComplete,
  ]);

  const stop = useCallback(async () => {
    try {
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
      tracks.current = [];
      stopListening();
      setIsActive(false);
      setIsListening(false);
      setIsLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [stopListening]);

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
