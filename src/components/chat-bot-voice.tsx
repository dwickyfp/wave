"use client";

import { getToolName, isToolUIPart, type ToolUIPart, type UIMessage } from "ai";

import { useOpenAIVoiceChat as OpenAIVoiceChat } from "lib/ai/speech/open-ai/use-voice-chat.openai";
import {
  AppDefaultToolkit,
  DefaultToolName,
  ImageToolName,
} from "lib/ai/tools";
import { cn, generateUUID, groupBy, isNull } from "lib/utils";
import {
  AudioLinesIcon,
  ArrowUpRight,
  CheckIcon,
  ChevronDown,
  Clock3Icon,
  Loader,
  MicIcon,
  MicOffIcon,
  PhoneIcon,
  TriangleAlertIcon,
  UserRoundCogIcon,
  XIcon,
} from "lucide-react";
import type { UseChatHelpers } from "@ai-sdk/react";
import {
  type CSSProperties,
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

import { Drawer, DrawerContent, DrawerPortal, DrawerTitle } from "ui/drawer";
import { MessageLoading } from "ui/message-loading";
import { ScrollArea } from "ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { KnowledgeImageMessagePart, ToolMessagePart } from "./message-parts";
import { Markdown } from "./markdown";
import { EnabledTools, EnabledToolsDropdown } from "./enabled-tools-dropdown";
import { appStore } from "@/app/store";
import { useShallow } from "zustand/shallow";
import { useLocale, useTranslations } from "next-intl";
import { isShortcutEvent, Shortcuts } from "lib/keyboard-shortcuts";
import { useAgent } from "@/hooks/queries/use-agent";
import { useAgents } from "@/hooks/queries/use-agents";
import { ChatMention } from "app-types/chat";
import { AgentSummary } from "app-types/agent";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import Link from "next/link";
import {
  type VoiceArtifactGridLayout,
  type VoiceLatestTurnModel,
  type VoiceRenderableArtifact,
  buildVoiceLatestTurnModel,
  getVoiceArtifactGridLayout,
} from "./chat-bot-voice.utils";
import { BarChart } from "./tool-invocation/bar-chart";
import { ImageGeneratorToolInvocation } from "./tool-invocation/image-generator";
import { InteractiveTable } from "./tool-invocation/interactive-table";
import { LineChart } from "./tool-invocation/line-chart";
import { PieChart } from "./tool-invocation/pie-chart";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";

export function ChatBotVoice() {
  const t = useTranslations("Chat");
  const locale = useLocale();
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
    transcriptionLanguage: locale,
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

  const handleSelectVoiceAgent = useCallback(
    async (nextAgent?: AgentSummary | null) => {
      const nextAgentId = nextAgent?.id;
      if ((agentId ?? undefined) === nextAgentId) {
        return;
      }

      if (isActive) {
        await safe(() => stop());
      }

      appStoreMutate((prev) => ({
        voiceChat: {
          ...prev.voiceChat,
          agentId: nextAgentId,
          threadId: generateUUID(),
        },
      }));
    },
    [agentId, appStoreMutate, isActive, stop],
  );

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
                <VoiceAgentSelector
                  selectedAgent={agent}
                  onSelectAgent={handleSelectVoiceAgent}
                />
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
            <div className="mx-auto flex-1 min-h-0 w-full max-w-[1760px] px-2 pb-40 md:px-4 xl:px-6">
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
                />
              )}
              <VoiceHiddenToolRunner
                messages={latestTurn.assistantMessages}
                addToolResult={addToolResult}
              />
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
    turn.floatingPromptText,
    ...turn.renderableArtifacts.map((artifact) =>
      artifact.kind === "tool"
        ? `${artifact.kind}:${artifact.messageId}:${artifact.part.toolCallId}:${artifact.part.state}`
        : artifact.kind === "knowledge-images"
          ? `${artifact.kind}:${artifact.messageId}:${artifact.images.map((image) => image.imageId).join(",")}`
          : artifact.kind === "markdown-table"
            ? `${artifact.kind}:${artifact.messageId}:${artifact.markdown}`
            : `${artifact.kind}:${artifact.messageId}:${artifact.part.url}`,
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

function VoiceTurnStage({
  turn,
  isProcessingTurn,
  isAssistantSpeaking,
  isUserSpeaking,
}: {
  turn: VoiceLatestTurnModel;
  isProcessingTurn: boolean;
  isAssistantSpeaking: boolean;
  isUserSpeaking: boolean;
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
  const soundBarMode = isAssistantSpeaking
    ? "speaking"
    : isUserSpeaking
      ? "listening"
      : isProcessingTurn
        ? "thinking"
        : "ready";

  return (
    <div className="relative flex h-full min-h-0 flex-col pb-4">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-4 px-1 md:px-2">
        <div className="pointer-events-auto flex justify-start">
          <VoiceStatusStrip
            callStateLabel={callStateLabel}
            isAssistantSpeaking={isAssistantSpeaking}
            isUserSpeaking={isUserSpeaking}
            runningToolStates={turn.runningToolStates}
          />
        </div>
        <VoiceFloatingPrompt text={turn.floatingPromptText} />
      </div>

      <div className="min-h-0 flex-1 pt-24 md:pt-28">
        <ScrollArea className="h-full">
          <div className="mx-auto min-h-full w-full px-0 pb-10 pt-2">
            {turn.hasRenderableArtifacts ? (
              <VoiceArtifactGrid artifacts={turn.renderableArtifacts} />
            ) : (
              <div className="flex min-h-[420px] items-center justify-center">
                <VoiceSoundBar mode={soundBarMode} />
              </div>
            )}
            <div ref={bottomAnchorRef} />
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

type VoiceSoundBarMode = "ready" | "thinking" | "listening" | "speaking";

function VoiceSoundBar({ mode }: { mode: VoiceSoundBarMode }) {
  const presets: Record<
    VoiceSoundBarMode,
    {
      minScale: number;
      durationBase: number;
      barColorClassName: string;
      glowClassName: string;
    }
  > = {
    ready: {
      minScale: 0.55,
      durationBase: 2.8,
      barColorClassName: "from-white/15 via-white/35 to-white/80",
      glowClassName: "shadow-[0_0_24px_rgba(255,255,255,0.08)]",
    },
    thinking: {
      minScale: 0.4,
      durationBase: 1.9,
      barColorClassName: "from-amber-500/15 via-amber-300/45 to-amber-100/80",
      glowClassName: "shadow-[0_0_30px_rgba(245,158,11,0.18)]",
    },
    listening: {
      minScale: 0.24,
      durationBase: 1.2,
      barColorClassName: "from-sky-500/20 via-cyan-300/55 to-cyan-100/90",
      glowClassName: "shadow-[0_0_32px_rgba(56,189,248,0.18)]",
    },
    speaking: {
      minScale: 0.18,
      durationBase: 0.95,
      barColorClassName:
        "from-emerald-500/20 via-emerald-300/55 to-emerald-100/90",
      glowClassName: "shadow-[0_0_34px_rgba(16,185,129,0.2)]",
    },
  };
  const preset = presets[mode];
  const barHeights = [38, 74, 54, 92, 126, 92, 54, 74, 38];

  return (
    <div className="flex w-full max-w-3xl items-center justify-center px-6">
      <div
        className={cn(
          "flex items-end gap-2 rounded-full bg-white/[0.02] px-10 py-8 backdrop-blur-[2px]",
          "md:gap-3 md:px-14 md:py-10",
          preset.glowClassName,
        )}
      >
        {barHeights.map((height, index) => (
          <span
            key={`${mode}-${height}-${index}`}
            className={cn(
              "voice-sound-bar__bar inline-flex w-2.5 origin-bottom rounded-full bg-gradient-to-t md:w-3.5",
              preset.barColorClassName,
            )}
            style={
              {
                height,
                animationDelay: `${index * 0.12}s`,
                animationDuration: `${preset.durationBase + (index % 3) * 0.18}s`,
                "--voice-bar-min-scale": preset.minScale,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <style jsx>{`
        .voice-sound-bar__bar {
          animation-name: voiceSoundBar;
          animation-iteration-count: infinite;
          animation-timing-function: ease-in-out;
          will-change: transform, opacity;
        }

        @keyframes voiceSoundBar {
          0%,
          100% {
            opacity: 0.4;
            transform: scaleY(var(--voice-bar-min-scale, 0.4));
          }
          50% {
            opacity: 1;
            transform: scaleY(1);
          }
        }
      `}</style>
    </div>
  );
}

function VoiceFloatingPrompt({ text }: { text: string }) {
  if (!text) {
    return null;
  }

  return (
    <div className="flex justify-center px-4">
      <p className="max-w-3xl text-center text-sm font-medium leading-6 text-foreground/90 line-clamp-2 drop-shadow-sm">
        {text}
      </p>
    </div>
  );
}

function VoiceAgentSelector({
  selectedAgent,
  onSelectAgent,
}: {
  selectedAgent?: AgentSummary | null;
  onSelectAgent: (agent?: AgentSummary | null) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const { myAgents, sharedAgents, isLoading } = useAgents({
    filters: ["all"],
    syncStore: false,
  });

  const hasAgents = myAgents.length + sharedAgents.length > 0;

  const renderAgentLabel = (agent?: AgentSummary | null) => {
    if (!agent) {
      return "No agent";
    }

    return agent.name;
  };

  const handleSelect = async (agent?: AgentSummary | null) => {
    await Promise.resolve(onSelectAgent(agent));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className="min-w-[172px] justify-between gap-2"
        >
          <div className="flex min-w-0 items-center gap-2">
            {selectedAgent ? (
              <div
                style={selectedAgent.icon?.style}
                className="flex size-6 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-background/40"
              >
                <Avatar className="size-4">
                  <AvatarImage src={selectedAgent.icon?.value} />
                  <AvatarFallback className="text-[10px]">
                    {selectedAgent.name.slice(0, 1)}
                  </AvatarFallback>
                </Avatar>
              </div>
            ) : (
              <div className="flex size-6 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-background/40">
                <UserRoundCogIcon className="size-3.5 text-muted-foreground" />
              </div>
            )}
            <span className="truncate text-left">
              {renderAgentLabel(selectedAgent)}
            </span>
          </div>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="end">
        <Command>
          <CommandInput placeholder="Search agent..." />
          <CommandList className="max-h-80">
            <CommandEmpty>
              {isLoading ? "Loading agents..." : "No agents found."}
            </CommandEmpty>
            <CommandGroup heading="Voice Mode">
              <CommandItem
                value="no-agent"
                onSelect={() => void handleSelect(undefined)}
                className="cursor-pointer"
              >
                <CheckIcon
                  className={cn(
                    "mr-2 size-3.5",
                    !selectedAgent ? "opacity-100" : "opacity-0",
                  )}
                />
                <div className="flex min-w-0 items-center gap-2">
                  <UserRoundCogIcon className="size-3.5 text-muted-foreground" />
                  <span>No agent</span>
                </div>
              </CommandItem>
            </CommandGroup>
            {hasAgents ? <CommandSeparator /> : null}
            {myAgents.length ? (
              <CommandGroup heading="My Agents">
                {myAgents.map((agent) => (
                  <VoiceAgentCommandItem
                    key={agent.id}
                    agent={agent}
                    selected={selectedAgent?.id === agent.id}
                    onSelect={handleSelect}
                  />
                ))}
              </CommandGroup>
            ) : null}
            {myAgents.length && sharedAgents.length ? (
              <CommandSeparator />
            ) : null}
            {sharedAgents.length ? (
              <CommandGroup heading="Shared Agents">
                {sharedAgents.map((agent) => (
                  <VoiceAgentCommandItem
                    key={agent.id}
                    agent={agent}
                    selected={selectedAgent?.id === agent.id}
                    onSelect={handleSelect}
                  />
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function VoiceAgentCommandItem({
  agent,
  selected,
  onSelect,
}: {
  agent: AgentSummary;
  selected: boolean;
  onSelect: (agent: AgentSummary) => void | Promise<void>;
}) {
  return (
    <CommandItem
      value={`${agent.name} ${agent.userName ?? ""}`}
      onSelect={() => void onSelect(agent)}
      className="cursor-pointer"
    >
      <CheckIcon
        className={cn("mr-2 size-3.5", selected ? "opacity-100" : "opacity-0")}
      />
      {agent.icon ? (
        <div
          style={agent.icon.style}
          className="mr-2 flex size-6 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-background/40"
        >
          <Avatar className="size-4">
            <AvatarImage src={agent.icon.value} />
            <AvatarFallback className="text-[10px]">
              {agent.name.slice(0, 1)}
            </AvatarFallback>
          </Avatar>
        </div>
      ) : (
        <div className="mr-2 flex size-6 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-background/40">
          <UserRoundCogIcon className="size-3.5 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{agent.name}</p>
        {agent.description ? (
          <p className="truncate text-xs text-muted-foreground">
            {agent.description}
          </p>
        ) : agent.userName ? (
          <p className="truncate text-xs text-muted-foreground">
            Shared by {agent.userName}
          </p>
        ) : null}
      </div>
    </CommandItem>
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

function getVoiceArtifactGridClassName(layout: VoiceArtifactGridLayout) {
  if (layout.desktopColumns === 1) {
    return "grid-cols-1";
  }

  if (layout.desktopColumns === 2) {
    return "md:grid-cols-2";
  }

  return "md:grid-cols-2 xl:grid-cols-3";
}

function getVoiceArtifactStageWidthClassName(layout: VoiceArtifactGridLayout) {
  if (layout.density === "feature") {
    return "max-w-[1480px]";
  }

  if (layout.density === "split") {
    return "max-w-[1640px]";
  }

  return "max-w-[1760px]";
}

function getVoiceArtifactTileHeightClassName(
  layout: VoiceArtifactGridLayout,
  artifactCount: number,
) {
  if (layout.density === "feature") {
    return "h-[420px] md:h-[560px] xl:h-[640px]";
  }

  if (layout.density === "split") {
    return "h-[360px] md:h-[460px] xl:h-[520px]";
  }

  if (layout.density === "triad") {
    return "h-[320px] md:h-[360px] xl:h-[420px]";
  }

  if (artifactCount === 4) {
    return "h-[320px] md:h-[400px] xl:h-[460px]";
  }

  return "h-[300px] md:h-[340px] xl:h-[400px]";
}

function VoiceArtifactGrid({
  artifacts,
}: {
  artifacts: VoiceRenderableArtifact[];
}) {
  const layout = getVoiceArtifactGridLayout(artifacts.length);

  return (
    <div className="flex min-h-[420px] items-start justify-center">
      <div
        className={cn(
          "mx-auto w-full",
          getVoiceArtifactStageWidthClassName(layout),
        )}
      >
        <div
          className={cn(
            "grid grid-cols-1 items-start gap-4 md:gap-5 xl:gap-6",
            getVoiceArtifactGridClassName(layout),
            layout.overflow &&
              "max-h-[calc(100vh-16.5rem)] overflow-y-auto overscroll-contain pr-1 md:pr-2",
          )}
        >
          {artifacts.map((artifact) => (
            <VoiceArtifactTile
              key={artifact.id}
              artifactCount={artifacts.length}
              artifactKind={artifact.kind}
              layout={layout}
            >
              <VoiceArtifactView artifact={artifact} density={layout.density} />
            </VoiceArtifactTile>
          ))}
        </div>
      </div>
    </div>
  );
}

function VoiceArtifactTile({
  artifactCount,
  artifactKind,
  layout,
  children,
}: {
  artifactCount: number;
  artifactKind: VoiceRenderableArtifact["kind"];
  layout: VoiceArtifactGridLayout;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-black/20 backdrop-blur-sm",
        "shadow-[0_18px_40px_rgba(0,0,0,0.22)]",
        getVoiceArtifactTileHeightClassName(layout, artifactCount),
        artifactCount === 1 && "mx-auto w-full",
        artifactKind === "image-file" || artifactKind === "image-source-url"
          ? "p-3 md:p-4"
          : "p-4 md:p-5",
      )}
    >
      {children}
    </div>
  );
}

function VoiceHiddenToolRunner({
  messages,
  addToolResult,
}: {
  messages: UIMessage[];
  addToolResult?: UseChatHelpers<UIMessage>["addToolResult"];
}) {
  const pendingParts = useMemo(
    () =>
      messages.flatMap((message) =>
        message.parts
          .filter(isToolUIPart)
          .filter(
            (part) =>
              !part.providerExecuted && !part.state.startsWith("output"),
          )
          .map((part) => ({
            messageId: message.id,
            part: part as ToolUIPart,
          })),
      ),
    [messages],
  );

  if (!pendingParts.length) {
    return null;
  }

  return (
    <div className="sr-only" aria-hidden="true">
      {pendingParts.map(({ messageId, part }) => (
        <ToolMessagePart
          key={`${messageId}-${part.toolCallId}`}
          part={part}
          messageId={messageId}
          showActions={false}
          readonly
          isLast
          isManualToolInvocation={false}
          addToolResult={addToolResult}
        />
      ))}
    </div>
  );
}

function VoiceArtifactView({
  artifact,
  density,
}: {
  artifact: VoiceRenderableArtifact;
  density: VoiceArtifactGridLayout["density"];
}) {
  switch (artifact.kind) {
    case "tool":
      return <VoiceToolArtifact part={artifact.part} density={density} />;
    case "knowledge-images":
      return (
        <div className="h-full min-h-0 overflow-auto">
          <KnowledgeImageMessagePart images={artifact.images} />
        </div>
      );
    case "markdown-table":
      return (
        <Markdown
          animate={false}
          displayVariant="voice-stage"
          voiceStageDensity={density}
        >
          {artifact.markdown}
        </Markdown>
      );
    case "image-file":
      return (
        <VoiceImageArtifact
          alt={artifact.part.filename || "Voice attachment"}
          src={artifact.part.url}
        />
      );
    case "image-source-url":
      return (
        <VoiceImageArtifact
          alt={artifact.part.title || "Voice attachment"}
          src={artifact.part.url}
        />
      );
  }
}

function VoiceToolArtifact({
  part,
  density,
}: {
  part: ToolUIPart;
  density: VoiceArtifactGridLayout["density"];
}) {
  const toolName = getToolName(part);

  switch (toolName) {
    case DefaultToolName.CreateLineChart:
      return (
        <LineChart
          {...(part.input as any)}
          displayVariant="voice-stage"
          voiceStageDensity={density}
        />
      );
    case DefaultToolName.CreateBarChart:
      return (
        <BarChart
          {...(part.input as any)}
          displayVariant="voice-stage"
          voiceStageDensity={density}
        />
      );
    case DefaultToolName.CreatePieChart:
      return (
        <PieChart
          {...(part.input as any)}
          displayVariant="voice-stage"
          voiceStageDensity={density}
        />
      );
    case DefaultToolName.CreateTable:
      return (
        <InteractiveTable
          {...(part.input as any)}
          displayVariant="voice-stage"
          voiceStageDensity={density}
        />
      );
    case ImageToolName:
      return <ImageGeneratorToolInvocation part={part} />;
    default:
      return null;
  }
}

function VoiceImageArtifact({
  alt,
  src,
}: {
  alt: string;
  src?: string;
}) {
  if (!src) {
    return null;
  }

  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="mx-auto h-full max-h-full w-full max-w-full rounded-[1.6rem] object-contain"
      />
    </div>
  );
}
