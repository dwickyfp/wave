"use client";

import { getStaticToolName, isStaticToolUIPart, TextPart, UIMessage } from "ai";

import { useOpenAIVoiceChat as OpenAIVoiceChat } from "lib/ai/speech/open-ai/use-voice-chat.openai";
import { AppDefaultToolkit, DefaultToolName } from "lib/ai/tools";
import { cn, generateUUID, groupBy, isNull } from "lib/utils";
import {
  ArrowUpRight,
  Loader,
  MicIcon,
  MicOffIcon,
  PhoneIcon,
  TriangleAlertIcon,
  XIcon,
  MessagesSquareIcon,
  MessageSquareMoreIcon,
  WrenchIcon,
  ChevronRight,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { safe } from "ts-safe";
import { Alert, AlertDescription, AlertTitle } from "ui/alert";
import { Button } from "ui/button";

import { Drawer, DrawerContent, DrawerPortal, DrawerTitle } from "ui/drawer";
import { MessageLoading } from "ui/message-loading";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { PreviewMessage } from "./message";

import { EnabledTools, EnabledToolsDropdown } from "./enabled-tools-dropdown";
import { appStore } from "@/app/store";
import { useShallow } from "zustand/shallow";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "ui/dialog";
import JsonView from "ui/json-view";
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
                    <CompactMessageView messages={messages} />
                  ) : (
                    <ConversationView
                      messages={messages}
                      isLoading={isProcessingTurn}
                      threadId={voiceChat.threadId}
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
}: {
  messages: UIMessage[];
  isLoading: boolean;
  threadId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTo({
        top: ref.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages.length]);
  return (
    <div className="select-text w-full overflow-y-auto h-full" ref={ref}>
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
            messageIndex={index}
          />
        ))}
      </div>
    </div>
  );
}

function CompactMessageView({
  messages,
}: {
  messages: UIMessage[];
}) {
  const { toolParts, textPart } = useMemo(() => {
    const toolParts = messages
      .filter((msg) => msg.parts.some(isStaticToolUIPart))
      .map((msg) => msg.parts.find(isStaticToolUIPart));

    const textPart = messages.findLast((msg) => msg.role === "assistant")
      ?.parts[0] as TextPart;
    return { toolParts, textPart };
  }, [messages]);

  return (
    <div className="relative w-full h-full overflow-hidden">
      <div className="absolute bottom-6 max-h-[80vh] overflow-y-auto left-6 z-10 flex-col gap-2 hidden md:flex">
        {toolParts.map((toolPart, index) => {
          const isExecuting = toolPart?.state.startsWith("input");
          if (!toolPart) return null;
          return (
            <Dialog key={index}>
              <DialogTrigger asChild>
                <div className="animate-in slide-in-from-bottom-2 fade-in duration-3000 max-w-xs w-full">
                  <Button
                    variant={"outline"}
                    size={"icon"}
                    className="w-full bg-card flex items-center gap-2 px-2 text-xs text-muted-foreground"
                  >
                    <WrenchIcon className="size-3.5" />
                    <span className="text-sm font-bold min-w-0 truncate mr-auto">
                      {getStaticToolName(toolPart)}
                    </span>
                    {isExecuting ? (
                      <Loader className="size-3.5 animate-spin" />
                    ) : (
                      <ChevronRight className="size-3.5" />
                    )}
                  </Button>
                </div>
              </DialogTrigger>
              <DialogContent className="z-50 md:max-w-2xl! max-h-[80vh] overflow-y-auto p-8">
                <DialogTitle>{getStaticToolName(toolPart)}</DialogTitle>
                <div className="flex flex-row gap-4 text-sm ">
                  <div className="w-1/2 min-w-0 flex flex-col">
                    <div className="flex items-center gap-2 mb-2 pt-2 pb-1 z-10">
                      <h5 className="text-muted-foreground text-sm font-medium">
                        Inputs
                      </h5>
                    </div>
                    <JsonView data={toolPart.input} />
                  </div>

                  <div className="w-1/2 min-w-0 pl-4 flex flex-col">
                    <div className="flex items-center gap-2 mb-4 pt-2 pb-1  z-10">
                      <h5 className="text-muted-foreground text-sm font-medium">
                        Outputs
                      </h5>
                    </div>
                    <JsonView
                      data={
                        toolPart.state === "output-available"
                          ? toolPart.output
                          : toolPart.state == "output-error"
                            ? toolPart.errorText
                            : {}
                      }
                    />
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          );
        })}
      </div>

      {/* Current Message - Prominent */}
      {textPart && (
        <div className="w-full mx-auto h-full max-h-[80vh] overflow-y-auto px-4 lg:max-w-4xl flex-1 flex items-center">
          <div className="animate-in fade-in-50 duration-1000">
            <p className="text-2xl md:text-3xl lg:text-4xl font-semibold leading-tight tracking-wide">
              {textPart.text?.split(" ").map((word, wordIndex) => (
                <span
                  key={wordIndex}
                  className="animate-in fade-in duration-5000"
                >
                  {word}{" "}
                </span>
              ))}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
