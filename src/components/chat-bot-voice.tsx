"use client";

import { getToolName, isToolUIPart, type ToolUIPart, type UIMessage } from "ai";

import { useOpenAIVoiceChat as OpenAIVoiceChat } from "lib/ai/speech/open-ai/use-voice-chat.openai";
import { AppDefaultToolkit, DefaultToolName } from "lib/ai/tools";
import { cn, generateUUID, groupBy, isNull } from "lib/utils";
import {
  AudioLinesIcon,
  ArrowUpRight,
  Clock3Icon,
  Loader,
  MicIcon,
  MicOffIcon,
  PhoneIcon,
  SparklesIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import type { UseChatHelpers } from "@ai-sdk/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import {
  FileMessagePart,
  KnowledgeImageMessagePart,
  SourceUrlMessagePart,
  ToolMessagePart,
} from "./message-parts";
import { Markdown } from "./markdown";
import { EnabledTools, EnabledToolsDropdown } from "./enabled-tools-dropdown";
import { appStore } from "@/app/store";
import { useShallow } from "zustand/shallow";
import { useTranslations } from "next-intl";
import { isShortcutEvent, Shortcuts } from "lib/keyboard-shortcuts";
import { useAgent } from "@/hooks/queries/use-agent";
import { ChatMention } from "app-types/chat";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import Link from "next/link";
import {
  type VoiceArtifactEntry,
  type VoiceLatestTurnModel,
  buildVoiceLatestTurnModel,
} from "./chat-bot-voice.utils";
import { buildRenderGroups } from "./message-render-groups";
import { ParallelSubAgentsGroup } from "./tool-invocation/parallel-subagents-group";

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
    if (isUserSpeaking) {
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
  const latestTurn = useMemo(
    () => buildVoiceLatestTurnModel(messages),
    [messages],
  );

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
          <div className="relative w-full h-full flex flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.10),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.10),transparent_28%)]">
            <div
              className="w-full flex items-center justify-between p-6 gap-3"
              style={{
                userSelect: "text",
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                {agent && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        style={agent.icon?.style}
                        className="size-10 shrink-0 items-center justify-center flex rounded-2xl ring ring-secondary/80 bg-background/40"
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
                        <div className="font-semibold text-sm">
                          {agent.name}
                        </div>
                        {agent.description && (
                          <div className="text-xs text-muted-foreground leading-relaxed">
                            {agent.description}
                          </div>
                        )}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {agent?.name ?? "Voice Call"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last-turn voice workspace
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <EnabledToolsDropdown
                  align="start"
                  side="bottom"
                  tools={tools}
                />
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
              </div>
              <DrawerTitle className="sr-only">Voice Chat</DrawerTitle>
            </div>
            <div className="flex-1 min-h-0 mx-auto w-full max-w-6xl px-4 pb-40 md:px-6">
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
                <div className="flex-1" />
              ) : (
                <VoiceTurnStage
                  turn={latestTurn}
                  isProcessingTurn={isProcessingTurn}
                  isAssistantSpeaking={isAssistantSpeaking}
                  isUserSpeaking={isUserSpeaking}
                  addToolResult={addToolResult}
                />
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

function buildVoiceStreamSignature(turn: VoiceLatestTurnModel) {
  return [
    turn.latestUserMessage?.id ?? "",
    turn.latestUserText,
    turn.assistantSummaryText,
    ...turn.artifactEntries.map((entry) =>
      [
        entry.message.id,
        ...entry.parts.map((part) => {
          if (part.type === "text") {
            return `text:${part.text}`;
          }
          if (isToolUIPart(part)) {
            return `${getToolName(part)}:${part.toolCallId}:${part.state}`;
          }
          if (part.type === "file") {
            return `file:${part.filename ?? part.url ?? ""}`;
          }
          if ((part as { type?: string }).type === "source-url") {
            return `source:${(part as { url?: string }).url ?? ""}`;
          }
          return part.type;
        }),
        ...entry.knowledgeImages.map((image) => image.imageId),
      ].join("|"),
    ),
    ...turn.runningToolStates.map((tool) => `${tool.id}:${tool.state}`),
  ].join("::");
}

function formatToolTitle(name: string) {
  return name
    .replace(/^tool-/, "")
    .replace(/^tool_/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getToolStatusLabel(part: ToolUIPart) {
  if (part.state === "output-error") {
    return "Failed";
  }

  if (part.state.startsWith("output")) {
    return "Ready";
  }

  return "Running";
}

function getToolStateTone(part: ToolUIPart) {
  if (part.state === "output-error") {
    return "border-destructive/20 bg-destructive/10 text-destructive";
  }

  if (part.state.startsWith("output")) {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  }

  return "border-amber-400/25 bg-amber-500/10 text-amber-100";
}

function VoiceTurnStage({
  turn,
  isProcessingTurn,
  isAssistantSpeaking,
  isUserSpeaking,
  addToolResult,
}: {
  turn: VoiceLatestTurnModel;
  isProcessingTurn: boolean;
  isAssistantSpeaking: boolean;
  isUserSpeaking: boolean;
  addToolResult?: UseChatHelpers<UIMessage>["addToolResult"];
}) {
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const streamSignature = useMemo(
    () => buildVoiceStreamSignature(turn),
    [turn],
  );

  useEffect(() => {
    bottomAnchorRef.current?.scrollIntoView({
      block: "end",
      behavior: "smooth",
    });
  }, [streamSignature]);

  const callStateLabel = isAssistantSpeaking
    ? "Speaking"
    : isUserSpeaking
      ? "Listening"
      : isProcessingTurn
        ? "Thinking"
        : "Ready";

  return (
    <div className="flex h-full flex-col gap-5 pb-4">
      <VoiceStatusStrip
        callStateLabel={callStateLabel}
        isAssistantSpeaking={isAssistantSpeaking}
        isUserSpeaking={isUserSpeaking}
        runningToolStates={turn.runningToolStates}
      />

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="gap-0 border-white/10 bg-background/50 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm tracking-wide text-muted-foreground">
              You asked
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {turn.latestUserText ? (
              <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">
                {turn.latestUserText}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Start speaking and the latest request will appear here.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="gap-0 border-white/10 bg-gradient-to-br from-card via-card to-sky-500/10 shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm tracking-wide text-muted-foreground">
              Assistant
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {turn.assistantSummaryText ? (
              <div className="text-base leading-7 md:text-lg">
                <Markdown animate={false}>{turn.assistantSummaryText}</Markdown>
              </div>
            ) : isProcessingTurn ? (
              <MessageLoading className="text-muted-foreground" />
            ) : (
              <p className="text-sm text-muted-foreground">
                The latest assistant answer will stay focused here.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-white/10 bg-card/95 shadow-xl backdrop-blur">
        <CardHeader className="border-b border-border/60 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Latest Result</CardTitle>
              <CardDescription>
                Charts, tables, images, code outputs, and tool progress from the
                latest turn.
              </CardDescription>
            </div>
            <Badge variant="outline" className="border-white/10 bg-white/5">
              {turn.artifactEntries.length
                ? `${turn.artifactEntries.length} item${turn.artifactEntries.length === 1 ? "" : "s"}`
                : "No artifacts"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 px-0">
          <ScrollArea className="h-full">
            <div className="space-y-6 px-5 pb-6 pt-5">
              {!turn.artifactEntries.length ? (
                <div className="flex min-h-[260px] items-center justify-center">
                  <div className="max-w-md rounded-[2rem] border border-dashed border-border/70 bg-background/40 px-6 py-8 text-center">
                    <SparklesIcon className="mx-auto mb-4 size-8 text-amber-300" />
                    <p className="text-lg font-medium">
                      Latest turn results appear here.
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Visual outputs and tool results from the current voice
                      turn will stay focused in this stage.
                    </p>
                  </div>
                </div>
              ) : (
                <VoiceArtifactStack
                  entries={turn.artifactEntries}
                  addToolResult={addToolResult}
                />
              )}
              <div ref={bottomAnchorRef} />
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function VoiceStatusStrip({
  callStateLabel,
  runningToolStates,
  isAssistantSpeaking,
  isUserSpeaking,
}: {
  callStateLabel: string;
  runningToolStates: VoiceLatestTurnModel["runningToolStates"];
  isAssistantSpeaking: boolean;
  isUserSpeaking: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge
        variant="outline"
        className={cn(
          "border-white/10 bg-white/5 text-foreground",
          isAssistantSpeaking && "border-sky-400/30 bg-sky-500/10 text-sky-100",
          isUserSpeaking &&
            "border-amber-400/30 bg-amber-500/10 text-amber-100",
        )}
      >
        <AudioLinesIcon className="size-3.5" />
        {callStateLabel}
      </Badge>
      {runningToolStates.slice(0, 3).map((toolState) => (
        <Badge
          key={toolState.id}
          variant="outline"
          className="border-amber-400/25 bg-amber-500/10 text-amber-100"
        >
          <Clock3Icon className="size-3.5" />
          {formatToolTitle(toolState.name)}
        </Badge>
      ))}
      {runningToolStates.length > 3 ? (
        <Badge variant="outline" className="border-white/10 bg-white/5">
          +{runningToolStates.length - 3} more
        </Badge>
      ) : null}
    </div>
  );
}

function VoiceArtifactStack({
  entries,
  addToolResult,
}: {
  entries: VoiceArtifactEntry[];
  addToolResult?: UseChatHelpers<UIMessage>["addToolResult"];
}) {
  return (
    <div className="space-y-5">
      {entries.map((entry) => (
        <VoiceArtifactEntryView
          key={entry.message.id}
          entry={entry}
          addToolResult={addToolResult}
        />
      ))}
    </div>
  );
}

function VoiceArtifactEntryView({
  entry,
  addToolResult,
}: {
  entry: VoiceArtifactEntry;
  addToolResult?: UseChatHelpers<UIMessage>["addToolResult"];
}) {
  const renderGroups = useMemo(
    () => buildRenderGroups(entry.parts, entry.knowledgeImages),
    [entry.knowledgeImages, entry.parts],
  );

  if (!renderGroups.length) {
    return null;
  }

  return (
    <div className="space-y-4">
      {renderGroups.map((group, groupIndex) => {
        if (group.type === "knowledge-images") {
          return (
            <VoiceArtifactShell
              key={`${entry.message.id}-images-${groupIndex}`}
              title="Related Images"
              statusLabel={`${group.images.length} image${group.images.length === 1 ? "" : "s"}`}
            >
              <KnowledgeImageMessagePart images={group.images} />
            </VoiceArtifactShell>
          );
        }

        if (group.type === "parallel-subagents") {
          return (
            <VoiceArtifactShell
              key={`${entry.message.id}-parallel-${group.startIndex}`}
              title="Parallel Agents"
              statusLabel={`${group.parts.length} running`}
            >
              <ParallelSubAgentsGroup parts={group.parts} />
            </VoiceArtifactShell>
          );
        }

        const { part, index } = group;
        if (part.type === "reasoning" || part.type === "step-start") {
          return null;
        }

        if (isToolUIPart(part)) {
          return (
            <VoiceToolArtifact
              key={`${entry.message.id}-tool-${part.toolCallId}-${index}`}
              part={part as ToolUIPart}
              message={entry.message}
              addToolResult={addToolResult}
            />
          );
        }

        if (part.type === "text") {
          return null;
        }

        if (part.type === "file") {
          return (
            <VoiceArtifactShell
              key={`${entry.message.id}-file-${index}`}
              title="Attachment"
              statusLabel={part.filename ?? "File"}
            >
              <FileMessagePart part={part} isUserMessage={false} />
            </VoiceArtifactShell>
          );
        }

        if ((part as { type?: string }).type === "source-url") {
          return (
            <VoiceArtifactShell
              key={`${entry.message.id}-source-${index}`}
              title="Reference"
              statusLabel="Attachment"
            >
              <SourceUrlMessagePart
                part={
                  part as { type: "source-url"; url: string; title?: string }
                }
                isUserMessage={false}
              />
            </VoiceArtifactShell>
          );
        }

        return (
          <VoiceArtifactShell
            key={`${entry.message.id}-${part.type}-${index}`}
            title="Assistant Output"
            statusLabel={part.type}
          >
            <VoiceGenericArtifact part={part} />
          </VoiceArtifactShell>
        );
      })}
    </div>
  );
}

function VoiceArtifactShell({
  title,
  statusLabel,
  children,
}: {
  title: string;
  statusLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[2rem] border border-white/10 bg-background/45 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          {title}
        </p>
        {statusLabel ? (
          <Badge variant="outline" className="border-white/10 bg-white/5">
            {statusLabel}
          </Badge>
        ) : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function VoiceGenericArtifact({
  part,
}: {
  part: Exclude<UIMessage["parts"][number], ToolUIPart>;
}) {
  return (
    <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20 p-4 text-xs leading-6 text-muted-foreground">
      {JSON.stringify(part, null, 2)}
    </pre>
  );
}

function VoiceToolArtifact({
  part,
  message,
  addToolResult,
}: {
  part: ToolUIPart;
  message: UIMessage;
  addToolResult?: UseChatHelpers<UIMessage>["addToolResult"];
}) {
  const rawToolName = getToolName(part);

  return (
    <VoiceArtifactShell
      title={formatToolTitle(rawToolName)}
      statusLabel={getToolStatusLabel(part)}
    >
      <div
        className={cn(
          "min-w-0 rounded-[1.5rem] border p-3",
          getToolStateTone(part),
        )}
      >
        <ToolMessagePart
          part={part}
          messageId={message.id}
          showActions={false}
          readonly
          isLast={!part.state.startsWith("output")}
          isManualToolInvocation={false}
          addToolResult={addToolResult}
        />
      </div>
    </VoiceArtifactShell>
  );
}
