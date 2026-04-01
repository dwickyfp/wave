"use client";

import {
  getStaticToolName,
  isToolUIPart,
  isStaticToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai";

import { useOpenAIVoiceChat as OpenAIVoiceChat } from "lib/ai/speech/open-ai/use-voice-chat.openai";
import { AppDefaultToolkit, DefaultToolName } from "lib/ai/tools";
import { cn, generateUUID, groupBy, isNull } from "lib/utils";
import {
  AudioLinesIcon,
  ArrowUpRight,
  BotIcon,
  CheckCircle2Icon,
  Clock3Icon,
  Loader,
  MicIcon,
  MicOffIcon,
  PhoneIcon,
  SparklesIcon,
  TriangleAlertIcon,
  UserRoundIcon,
  XIcon,
  MessagesSquareIcon,
  MessageSquareMoreIcon,
} from "lucide-react";
import type { UseChatHelpers } from "@ai-sdk/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { safe } from "ts-safe";
import { Alert, AlertDescription, AlertTitle } from "ui/alert";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/card";

import { Drawer, DrawerContent, DrawerPortal, DrawerTitle } from "ui/drawer";
import { MessageLoading } from "ui/message-loading";
import { ScrollArea } from "ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { PreviewMessage } from "./message";

import { EnabledTools, EnabledToolsDropdown } from "./enabled-tools-dropdown";
import { appStore } from "@/app/store";
import { useShallow } from "zustand/shallow";
import { useTranslations } from "next-intl";
import { isShortcutEvent, Shortcuts } from "lib/keyboard-shortcuts";
import { useAgent } from "@/hooks/queries/use-agent";
import { ChatMention } from "app-types/chat";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import Link from "next/link";

export function ChatBotVoice() {
  const t = useTranslations("Chat");
  const [
    agentId,
    appStoreMutate,
    voiceChat,
    allowedMcpServers,
    allowedAppDefaultToolkit,
    mcpList,
  ] = appStore(
    useShallow((state) => [
      state.voiceChat.agentId,
      state.mutate,
      state.voiceChat,
      state.allowedMcpServers,
      state.allowedAppDefaultToolkit,
      state.mcpList,
    ]),
  );

  const { agent } = useAgent(agentId);

  const [isClosing, setIsClosing] = useState(false);
  const startAudio = useRef<HTMLAudioElement>(null);
  const [useCompactView, setUseCompactView] = useState(true);

  const voiceMentions = useMemo<ChatMention[]>(() => {
    if (!agentId) {
      return [];
    }

    return (
      agent?.instructions.mentions?.filter(
        (mention) => mention.type !== "agent",
      ) ?? []
    );
  }, [agentId, agent]);

  const {
    isListening,
    isAssistantSpeaking,
    isLoading,
    isProcessingTurn,
    isActive,
    isUserSpeaking,
    messages,
    addToolResult,
    error,
    start,
    startListening,
    stop,
    stopListening,
  } = OpenAIVoiceChat({
    mentions: voiceMentions,
    agentId,
    allowedMcpServers,
    allowedAppDefaultToolkit,
    threadId: voiceChat.threadId,
    voice: voiceChat.options.voice,
  });

  const startWithSound = useCallback(() => {
    if (!startAudio.current) {
      startAudio.current = new Audio("/sounds/start_voice.ogg");
    }
    start().then(() => {
      startAudio.current?.play().catch(() => {});
    });
  }, [start]);

  const endVoiceChat = useCallback(async () => {
    setIsClosing(true);
    await safe(() => stop());
    setIsClosing(false);
    appStoreMutate({
      voiceChat: {
        ...voiceChat,
        agentId: undefined,
        isOpen: false,
        threadId: undefined,
      },
    });
  }, [appStoreMutate, stop, voiceChat]);

  const statusMessage = useMemo(() => {
    if (isLoading) {
      return (
        <p className="fade-in animate-in duration-3000" key="start">
          {t("VoiceChat.preparing")}
        </p>
      );
    }
    if (isProcessingTurn) {
      return <MessageLoading className="text-muted-foreground" />;
    }
    if (!isActive)
      return (
        <p className="fade-in animate-in duration-3000" key="start">
          {t("VoiceChat.startVoiceChat")}
        </p>
      );
    if (!isListening)
      return (
        <p className="fade-in animate-in duration-3000" key="stop">
          {t("VoiceChat.yourMicIsOff")}
        </p>
      );
    if (!isAssistantSpeaking && messages.length === 0) {
      return (
        <p className="fade-in animate-in duration-3000" key="ready">
          {t("VoiceChat.readyWhenYouAreJustStartTalking")}
        </p>
      );
    }
    if (isUserSpeaking && useCompactView) {
      return <MessageLoading className="text-muted-foreground" />;
    }
    if (!isAssistantSpeaking && !isUserSpeaking) {
      return (
        <p className="delayed-fade-in" key="ready">
          {t("VoiceChat.readyWhenYouAreJustStartTalking")}
        </p>
      );
    }
  }, [
    isAssistantSpeaking,
    isUserSpeaking,
    isActive,
    isLoading,
    isProcessingTurn,
    isListening,
    messages.length,
    useCompactView,
  ]);

  const tools = useMemo<EnabledTools[]>(() => {
    const mentionDrivenTools = (() => {
      if (!voiceMentions.length) {
        return [];
      }

      const mentionGroups: EnabledTools[] = [];
      const mcpMentions = voiceMentions.filter(
        (mention) => mention.type === "mcpTool",
      ) as Extract<ChatMention, { type: "mcpTool" }>[];
      const workflowMentions = voiceMentions.filter(
        (mention) => mention.type === "workflow",
      ) as Extract<ChatMention, { type: "workflow" }>[];
      const defaultToolMentions = voiceMentions.filter(
        (mention) => mention.type === "defaultTool",
      ) as Extract<ChatMention, { type: "defaultTool" }>[];

      if (mcpMentions.length) {
        const mcpGroups = groupBy(mcpMentions, "serverName");
        mentionGroups.push(
          ...Object.entries(mcpGroups).map(([serverName, tools]) => ({
            groupName: serverName || "MCP Tools",
            tools: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
            })),
          })),
        );
      }

      if (workflowMentions.length) {
        mentionGroups.push({
          groupName: "Workflows",
          tools: workflowMentions.map((workflow) => ({
            name: workflow.name,
            description: workflow.description ?? "",
          })),
        });
      }

      if (defaultToolMentions.length) {
        mentionGroups.push({
          groupName: "App Tools",
          tools: defaultToolMentions.map((tool) => ({
            name: tool.label,
            description: tool.description ?? "",
          })),
        });
      }

      return mentionGroups;
    })();

    if (mentionDrivenTools.length) {
      return mentionDrivenTools;
    }

    const defaultToolGroups: Record<AppDefaultToolkit, EnabledTools> = {
      [AppDefaultToolkit.Visualization]: {
        groupName: "Visualization",
        tools: [
          { name: DefaultToolName.CreatePieChart },
          { name: DefaultToolName.CreateBarChart },
          { name: DefaultToolName.CreateLineChart },
          { name: DefaultToolName.CreateTable },
        ],
      },
      [AppDefaultToolkit.WebSearch]: {
        groupName: "Web Search",
        tools: [
          { name: DefaultToolName.WebSearch },
          { name: DefaultToolName.WebContent },
        ],
      },
      [AppDefaultToolkit.Http]: {
        groupName: "HTTP",
        tools: [{ name: DefaultToolName.Http }],
      },
      [AppDefaultToolkit.Code]: {
        groupName: "Code",
        tools: [
          { name: DefaultToolName.JavascriptExecution },
          { name: DefaultToolName.PythonExecution },
        ],
      },
    };

    const configuredDefaultTools = (allowedAppDefaultToolkit ?? [])
      .map((toolkit) => defaultToolGroups[toolkit])
      .filter(Boolean);

    const configuredMcpTools = mcpList
      .filter(
        (server) =>
          server.id in (allowedMcpServers ?? {}) &&
          allowedMcpServers?.[server.id]?.tools?.length,
      )
      .map((server) => {
        const configuredTools = allowedMcpServers?.[server.id]?.tools ?? [];

        return {
          groupName: server.name,
          tools: configuredTools.map((toolName) => {
            const toolInfo = server.toolInfo.find(
              (tool) => tool.name === toolName,
            );
            return {
              name: toolName,
              description: toolInfo?.description ?? "",
            };
          }),
        };
      });

    return [...configuredDefaultTools, ...configuredMcpTools];
  }, [allowedAppDefaultToolkit, allowedMcpServers, mcpList, voiceMentions]);

  const hasPendingInteractiveToolStep = useMemo(
    () =>
      messages.some((message) =>
        message.parts.some(
          (part) =>
            isToolUIPart(part) &&
            !part.providerExecuted &&
            !part.state.startsWith("output"),
        ),
      ),
    [messages],
  );

  useEffect(() => {
    if (hasPendingInteractiveToolStep && useCompactView) {
      setUseCompactView(false);
    }
  }, [hasPendingInteractiveToolStep, useCompactView]);

  useEffect(() => {
    return () => {
      if (isActive) {
        stop();
      }
    };
  }, [voiceChat.options, isActive]);

  useEffect(() => {
    if (voiceChat.isOpen) {
      // startWithSound();
    } else if (isActive) {
      stop();
    }
  }, [voiceChat.isOpen]);

  useEffect(() => {
    if (
      !voiceChat.isOpen &&
      (!isNull(voiceChat.agentId) || !isNull(voiceChat.threadId))
    ) {
      appStoreMutate((prev) => ({
        voiceChat: {
          ...prev.voiceChat,
          agentId: undefined,
          threadId: undefined,
        },
      }));
    }
  }, [appStoreMutate, voiceChat.agentId, voiceChat.isOpen, voiceChat.threadId]);

  useEffect(() => {
    if (voiceChat.isOpen && !voiceChat.threadId) {
      appStoreMutate((prev) => ({
        voiceChat: {
          ...prev.voiceChat,
          threadId: generateUUID(),
        },
      }));
    }
  }, [appStoreMutate, voiceChat.isOpen, voiceChat.threadId]);

  useEffect(() => {
    if (error && isActive) {
      toast.error(error.message);
      stop();
    }
  }, [error]);

  useEffect(() => {
    if (voiceChat.isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isVoiceChatEvent = isShortcutEvent(e, Shortcuts.toggleVoiceChat);
      if (isVoiceChatEvent) {
        e.preventDefault();
        e.stopPropagation();
        appStoreMutate((prev) => ({
          voiceChat: {
            ...prev.voiceChat,
            isOpen: true,
            agentId: undefined,
            threadId: generateUUID(),
          },
        }));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [voiceChat.isOpen]);

  return (
    <Drawer dismissible={false} open={voiceChat.isOpen} direction="top">
      <DrawerPortal>
        <DrawerContent className="max-h-[100vh]! h-full border-none! rounded-none! flex flex-col bg-card">
          <div className="w-full h-full flex flex-col ">
            <div
              className="w-full flex p-6 gap-2"
              style={{
                userSelect: "text",
              }}
            >
              {agent && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      style={agent.icon?.style}
                      className="size-9 items-center justify-center flex rounded-lg ring ring-secondary"
                    >
                      <Avatar className="size-6">
                        <AvatarImage src={agent.icon?.value} />
                        <AvatarFallback>
                          {agent.name.slice(0, 1)}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="p-3 max-w-xs">
                    <div className="space-y-2">
                      <div className="font-semibold text-sm">{agent.name}</div>
                      {agent.description && (
                        <div className="text-xs text-muted-foreground leading-relaxed">
                          {agent.description}
                        </div>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={"secondary"}
                    size={"icon"}
                    disabled={hasPendingInteractiveToolStep}
                    onClick={() => setUseCompactView(!useCompactView)}
                  >
                    {useCompactView ? (
                      <MessageSquareMoreIcon />
                    ) : (
                      <MessagesSquareIcon />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {useCompactView
                    ? t("VoiceChat.compactDisplayMode")
                    : t("VoiceChat.conversationDisplayMode")}
                </TooltipContent>
              </Tooltip>

              <EnabledToolsDropdown align="start" side="bottom" tools={tools} />
              {voiceChat.threadId ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button asChild variant={"secondary"} size={"icon"}>
                      <Link href={`/chat/${voiceChat.threadId}`}>
                        <ArrowUpRight className="size-4" />
                      </Link>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Open thread</TooltipContent>
                </Tooltip>
              ) : null}
              <DrawerTitle className="sr-only">Voice Chat</DrawerTitle>
            </div>
            <div className="flex-1 min-h-0 mx-auto w-full">
              {error ? (
                <div className="max-w-3xl mx-auto">
                  <Alert variant={"destructive"}>
                    <TriangleAlertIcon className="size-4 " />
                    <AlertTitle className="">Error</AlertTitle>
                    <AlertDescription>{error.message}</AlertDescription>

                    <AlertDescription className="my-4 ">
                      <p className="text-muted-foreground ">
                        {t("VoiceChat.pleaseCloseTheVoiceChatAndTryAgain")}
                      </p>
                    </AlertDescription>
                  </Alert>
                </div>
              ) : null}
              {isLoading ? (
                <div className="flex-1"></div>
              ) : (
                <div className="h-full w-full">
                  {useCompactView ? (
                    <CompactMessageView
                      messages={messages}
                      isProcessingTurn={isProcessingTurn}
                      isAssistantSpeaking={isAssistantSpeaking}
                      isUserSpeaking={isUserSpeaking}
                    />
                  ) : (
                    <ConversationView
                      messages={messages}
                      isLoading={isProcessingTurn}
                      threadId={voiceChat.threadId}
                      addToolResult={addToolResult}
                    />
                  )}
                </div>
              )}
            </div>
            <div className="relative w-full p-6 flex items-center justify-center gap-4">
              <div className="text-sm text-muted-foreground absolute -top-5 left-0 w-full justify-center flex items-center">
                {statusMessage}
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={"secondary"}
                    size={"icon"}
                    disabled={isClosing || isLoading || isProcessingTurn}
                    onClick={() => {
                      if (!isActive) {
                        startWithSound();
                      } else if (isListening) {
                        stopListening();
                      } else {
                        startListening();
                      }
                    }}
                    className={cn(
                      "rounded-full p-6 transition-colors duration-300",

                      isLoading
                        ? "bg-accent-foreground text-accent animate-pulse"
                        : !isActive
                          ? "bg-green-500/10 text-green-500 hover:bg-green-500/30"
                          : !isListening
                            ? "bg-destructive/30 text-destructive hover:bg-destructive/10"
                            : isUserSpeaking
                              ? "bg-input text-foreground"
                              : "",
                    )}
                  >
                    {isLoading || isClosing ? (
                      <Loader className="size-6 animate-spin" />
                    ) : !isActive ? (
                      <PhoneIcon className="size-6 fill-green-500 stroke-none" />
                    ) : isListening ? (
                      <MicIcon
                        className={`size-6 ${isUserSpeaking ? "text-primary" : "text-muted-foreground transition-colors duration-300"}`}
                      />
                    ) : (
                      <MicOffIcon className="size-6" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {!isActive
                    ? t("VoiceChat.startConversation")
                    : isListening
                      ? t("VoiceChat.closeMic")
                      : t("VoiceChat.openMic")}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={"secondary"}
                    size={"icon"}
                    className="rounded-full p-6"
                    disabled={isLoading || isClosing}
                    onClick={endVoiceChat}
                  >
                    <XIcon className="text-foreground size-6" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("VoiceChat.endConversation")}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </DrawerContent>
      </DrawerPortal>
    </Drawer>
  );
}

function ConversationView({
  messages,
  isLoading,
  threadId,
  addToolResult,
}: {
  messages: UIMessage[];
  isLoading: boolean;
  threadId?: string;
  addToolResult?: UseChatHelpers<UIMessage>["addToolResult"];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const streamSignature = useMemo(
    () => buildVoiceStreamSignature(messages),
    [messages],
  );

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTo({
        top: ref.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [streamSignature]);
  return (
    <div className="h-full overflow-y-auto select-text" ref={ref}>
      <div>
        <div className="max-w-4xl mx-auto flex flex-col px-6 gap-6 pb-44 min-h-0 min-w-0">
          {messages.map((message, index) => (
            <PreviewMessage
              key={message.id}
              readonly
              message={message}
              prevMessage={messages[index - 1]}
              isLoading={isLoading && index === messages.length - 1}
              isLastMessage={index === messages.length - 1}
              threadId={threadId}
              addToolResult={addToolResult}
              messageIndex={index}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function getMessageText(message: UIMessage) {
  return message.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function buildVoiceStreamSignature(messages: UIMessage[]) {
  return [
    ...messages.map((message) =>
      [
        message.id,
        message.role,
        ...message.parts.map((part) => {
          if (part.type === "text") {
            return `text:${part.text}`;
          }
          if (isStaticToolUIPart(part)) {
            return `${getStaticToolName(part)}:${part.state}`;
          }
          return part.type;
        }),
      ].join("|"),
    ),
  ].join("::");
}

function summarizeToolOutput(part: ToolUIPart) {
  if (part.state === "output-error") {
    return part.errorText || "Tool execution failed.";
  }

  if (part.state !== "output-available") {
    return "Running...";
  }

  const output = part.output as unknown;
  if (typeof output === "string") {
    return output.slice(0, 180);
  }

  if (Array.isArray(output)) {
    return `${output.length} item${output.length === 1 ? "" : "s"} returned`;
  }

  if (output && typeof output === "object") {
    const keys = Object.keys(output as Record<string, unknown>);
    if ("statusMessage" in (output as Record<string, unknown>)) {
      return String((output as Record<string, unknown>).statusMessage);
    }
    if ("result" in (output as Record<string, unknown>)) {
      return "Completed with structured output";
    }
    return keys.length
      ? `Returned ${keys.slice(0, 4).join(", ")}`
      : "Completed";
  }

  return "Completed";
}

function VoiceCompactCallView({
  messages,
  isProcessingTurn,
  isAssistantSpeaking,
  isUserSpeaking,
}: {
  messages: UIMessage[];
  isProcessingTurn: boolean;
  isAssistantSpeaking: boolean;
  isUserSpeaking: boolean;
}) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const streamSignature = useMemo(
    () => buildVoiceStreamSignature(messages),
    [messages],
  );

  const transcriptMessages = useMemo(() => {
    return messages
      .filter(
        (message) => message.role === "user" || message.role === "assistant",
      )
      .map((message) => ({
        id: message.id,
        role: message.role,
        text: getMessageText(message),
      }))
      .filter((message) => message.text)
      .slice(-6);
  }, [messages]);

  const latestAssistantText = useMemo(() => {
    for (let index = transcriptMessages.length - 1; index >= 0; index -= 1) {
      if (transcriptMessages[index]?.role === "assistant") {
        return transcriptMessages[index].text;
      }
    }
    return "";
  }, [transcriptMessages]);

  const toolActivities = useMemo(() => {
    return messages
      .flatMap((message) =>
        message.parts.filter(isStaticToolUIPart).map((part) => ({
          id: `${message.id}-${part.toolCallId}`,
          name: getStaticToolName(part),
          part: part as ToolUIPart,
        })),
      )
      .slice(-8);
  }, [messages]);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTo({
        top: transcriptRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [streamSignature]);

  const activeToolCount = toolActivities.filter((activity) =>
    activity.part.state.startsWith("input"),
  ).length;

  return (
    <div className="relative h-full overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.12),transparent_32%)]" />
      <div className="relative mx-auto grid h-full max-w-6xl gap-6 px-4 pb-40 md:px-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-h-0 gap-0 overflow-hidden border-white/10 bg-gradient-to-br from-card via-card to-amber-500/5 shadow-2xl">
          <CardHeader className="border-b border-border/60 pb-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <Badge
                  variant="outline"
                  className="border-amber-500/30 bg-amber-500/10 text-amber-200"
                >
                  <AudioLinesIcon className="size-3.5" />
                  Live Call
                </Badge>
                <CardTitle className="text-xl tracking-tight">
                  Voice Timeline
                </CardTitle>
                <CardDescription>
                  Live transcript while you speak, then concise assistant
                  replies and tool progress.
                </CardDescription>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "border-white/10 bg-white/5",
                  isAssistantSpeaking &&
                    "border-sky-400/30 bg-sky-500/10 text-sky-100",
                  isUserSpeaking &&
                    "border-amber-400/30 bg-amber-500/10 text-amber-100",
                )}
              >
                {isAssistantSpeaking
                  ? "Assistant speaking"
                  : isUserSpeaking
                    ? "Listening"
                    : isProcessingTurn
                      ? "Thinking"
                      : "Ready"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 px-0">
            <div
              ref={transcriptRef}
              className="h-full overflow-y-auto space-y-4 px-6 pb-6 pt-4"
            >
              {!transcriptMessages.length ? (
                <div className="flex min-h-[280px] items-center justify-center">
                  <div className="max-w-md rounded-[2rem] border border-dashed border-border/70 bg-background/40 px-6 py-8 text-center">
                    <SparklesIcon className="mx-auto mb-4 size-8 text-amber-300" />
                    <p className="text-lg font-medium">
                      Start speaking naturally.
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      The drawer will keep your conversation and show tool
                      activity as it happens.
                    </p>
                  </div>
                </div>
              ) : null}

              {transcriptMessages.map((message) => {
                const isAssistant = message.role === "assistant";
                const isLatestAssistant =
                  isAssistant &&
                  message.id ===
                    transcriptMessages.findLast(
                      (entry) => entry.role === "assistant",
                    )?.id;

                return (
                  <div
                    key={message.id}
                    className={cn(
                      "max-w-3xl rounded-[2rem] border px-5 py-4 shadow-sm backdrop-blur-sm",
                      isAssistant
                        ? "mr-10 border-white/10 bg-white/5"
                        : "ml-10 border-amber-500/20 bg-amber-500/10",
                    )}
                  >
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                      {isAssistant ? (
                        <BotIcon className="size-3.5" />
                      ) : (
                        <UserRoundIcon className="size-3.5" />
                      )}
                      {isAssistant ? "Assistant" : "You"}
                    </div>
                    <p
                      className={cn(
                        "whitespace-pre-wrap text-sm leading-7 md:text-base",
                        isLatestAssistant && "text-lg font-medium md:text-xl",
                      )}
                    >
                      {message.text}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="grid min-h-0 gap-6 lg:grid-rows-[auto_minmax(0,1fr)]">
          <Card className="gap-0 overflow-hidden border-white/10 bg-gradient-to-br from-sky-500/10 via-card to-amber-500/10">
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Assistant Reply</CardTitle>
              <CardDescription>
                Spoken output stays short and focused for voice calls.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {latestAssistantText ? (
                <p className="line-clamp-6 whitespace-pre-wrap text-base leading-7">
                  {latestAssistantText}
                </p>
              ) : isProcessingTurn ? (
                <div className="py-2">
                  <MessageLoading className="text-muted-foreground" />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The next assistant reply will appear here as it streams.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="min-h-0 gap-0 overflow-hidden border-white/10 bg-card/95 backdrop-blur">
            <CardHeader className="border-b border-border/60 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Tool Activity</CardTitle>
                  <CardDescription>
                    Live execution view for charts, tables, workflows, and
                    external actions.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="border-white/10 bg-white/5">
                  {activeToolCount > 0
                    ? `${activeToolCount} running`
                    : `${toolActivities.length} recent`}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 px-0">
              <ScrollArea className="h-full">
                <div className="space-y-3 px-6 pb-6 pt-4">
                  {toolActivities.length ? (
                    toolActivities.map((activity) => {
                      const isRunning = activity.part.state.startsWith("input");
                      const isError = activity.part.state === "output-error";

                      return (
                        <div
                          key={activity.id}
                          className={cn(
                            "rounded-2xl border px-4 py-3 shadow-sm",
                            isRunning
                              ? "border-amber-500/25 bg-amber-500/10"
                              : isError
                                ? "border-destructive/25 bg-destructive/10"
                                : "border-sky-500/20 bg-sky-500/10",
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="truncate text-sm font-semibold">
                              {activity.name}
                            </p>
                            <Badge
                              variant="outline"
                              className={cn(
                                "border-current/20 bg-background/40",
                                isRunning &&
                                  "text-amber-200 border-amber-300/20",
                                !isRunning &&
                                  !isError &&
                                  "text-sky-100 border-sky-300/20",
                                isError && "text-red-100 border-red-300/20",
                              )}
                            >
                              {isRunning ? (
                                <Clock3Icon className="size-3.5" />
                              ) : (
                                <CheckCircle2Icon className="size-3.5" />
                              )}
                              {isRunning
                                ? "Running"
                                : isError
                                  ? "Failed"
                                  : "Done"}
                            </Badge>
                          </div>
                          <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
                            {summarizeToolOutput(activity.part)}
                          </p>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border/70 bg-background/30 px-4 py-6 text-sm text-muted-foreground">
                      Tool activity will show up here as the voice agent runs
                      workflows, charts, tables, or MCP actions.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function CompactMessageView({
  messages,
  isProcessingTurn,
  isAssistantSpeaking,
  isUserSpeaking,
}: {
  messages: UIMessage[];
  isProcessingTurn: boolean;
  isAssistantSpeaking: boolean;
  isUserSpeaking: boolean;
}) {
  return (
    <VoiceCompactCallView
      messages={messages}
      isProcessingTurn={isProcessingTurn}
      isAssistantSpeaking={isAssistantSpeaking}
      isUserSpeaking={isUserSpeaking}
    />
  );
}
