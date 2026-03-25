"use client";

import { appStore } from "@/app/store";
import { useChat } from "@ai-sdk/react";
import clsx from "clsx";
import { cn, createDebounce, generateUUID, truncateString } from "lib/utils";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { ChatGreeting } from "./chat-greeting";
import { ErrorMessage, PreviewMessage } from "./message";
import PromptInput from "./prompt-input";

import {
  DefaultChatTransport,
  TextUIPart,
  UIMessage,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { useShallow } from "zustand/shallow";

import { deleteThreadAction } from "@/app/api/chat/actions";
import { useGenerateThreadTitle } from "@/hooks/queries/use-generate-thread-title";
import { useChatShellState } from "@/hooks/use-chat-shell-state";
import { useFileDragOverlay } from "@/hooks/use-file-drag-overlay";
import { useToRef } from "@/hooks/use-latest";
import { useMounted } from "@/hooks/use-mounted";
import { useThreadFileUploader } from "@/hooks/use-thread-file-uploader";
import {
  ChatApiSchemaRequestBody,
  ChatAttachment,
  ChatModel,
  ChatThreadCompactionCheckpoint,
} from "app-types/chat";
import { AnimatePresence, motion } from "framer-motion";
import { appendAbortedResponseNotice } from "lib/ai/append-aborted-response-notice";
import { getStorageManager } from "lib/browser-stroage";
import {
  applyFinalizedAssistantText,
  stripKnowledgeCitationLinks,
} from "lib/chat/knowledge-citations";
import { Shortcuts, isShortcutEvent } from "lib/keyboard-shortcuts";
import { ArrowDown, FilePlus, Loader } from "lucide-react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { safe } from "ts-safe";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Think } from "ui/think";
import { CitationPreviewPanel } from "./citation-preview-panel";

type Props = {
  threadId: string;
  initialMessages: Array<UIMessage>;
  initialCompactionCheckpoint?: ChatThreadCompactionCheckpoint | null;
  selectedChatModel?: string;
};

type SessionCompactionBaseline = {
  usedTokens: number;
  messageCount: number;
};

const LightRays = dynamic(() => import("ui/light-rays"), {
  ssr: false,
});

const Particles = dynamic(() => import("ui/particles"), {
  ssr: false,
});

const debounce = createDebounce();

const firstTimeStorage = getStorageManager("IS_FIRST");
const isFirstTime = firstTimeStorage.get() ?? true;
firstTimeStorage.set(false);

export default function ChatBot({
  threadId,
  initialMessages,
  initialCompactionCheckpoint,
}: Props) {
  useChatShellState(threadId);

  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const { uploadFiles } = useThreadFileUploader(threadId);
  const handleFileDrop = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      await uploadFiles(files);
    },
    [uploadFiles],
  );
  const { isDragging } = useFileDragOverlay({
    onDropFiles: handleFileDrop,
  });

  const [
    appStoreMutate,
    model,
    toolChoice,
    allowedAppDefaultToolkit,
    allowedMcpServers,
    threadMentions,
    pendingThreadMention,
    threadImageToolModel,
    citationDocumentPreview,
  ] = appStore(
    useShallow((state) => [
      state.mutate,
      state.chatModel,
      state.toolChoice,
      state.allowedAppDefaultToolkit,
      state.allowedMcpServers,
      state.threadMentions,
      state.pendingThreadMention,
      state.threadImageToolModel,
      state.citationDocumentPreview,
    ]),
  );

  const generateTitle = useGenerateThreadTitle({
    threadId,
  });

  const [showParticles, setShowParticles] = useState(isFirstTime);
  const [isCompactingContext, setIsCompactingContext] = useState(false);
  const setMessagesRef = useRef<
    | ((
        messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[]),
      ) => void)
    | null
  >(null);
  const [compactionCheckpoint, setCompactionCheckpoint] = useState<Pick<
    ChatThreadCompactionCheckpoint,
    "summaryText" | "compactedMessageCount" | "summaryTokenCount"
  > | null>(initialCompactionCheckpoint ?? null);
  const [sessionCompactionBaseline, setSessionCompactionBaseline] =
    useState<SessionCompactionBaseline | null>(null);

  const onFinish = useCallback(
    ({
      message,
      messages: finishedMessages,
      isAbort,
    }: {
      message: UIMessage;
      messages: UIMessage[];
      isAbort: boolean;
    }) => {
      const normalizedMessages = isAbort
        ? finishedMessages.map((currentMessage) =>
            currentMessage.id === message.id
              ? appendAbortedResponseNotice(currentMessage)
              : currentMessage,
          )
        : finishedMessages;

      if (isAbort) {
        setMessagesRef.current?.((currentMessages) =>
          currentMessages.map((currentMessage) =>
            currentMessage.id === message.id
              ? appendAbortedResponseNotice(currentMessage)
              : currentMessage,
          ),
        );
      }

      setIsCompactingContext(false);
      const prevThread = appStore
        .getState()
        .threadList.find((value) => value.id === threadId);
      const isNewThread =
        !prevThread?.title &&
        normalizedMessages.filter(
          (v) => v.role === "user" || v.role === "assistant",
        ).length < 3;
      if (isNewThread) {
        const part = normalizedMessages
          .slice(0, 2)
          .flatMap((m) =>
            m.parts
              .filter((v) => v.type === "text")
              .map(
                (p) =>
                  `${m.role}: ${truncateString((p as TextUIPart).text, 500)}`,
              ),
          );
        if (part.length > 0) {
          generateTitle(part.join("\n\n"));
        }
      } else if (appStore.getState().threadList[0]?.id !== threadId) {
        mutate("/api/thread");
      }
    },
    [],
  );

  const [input, setInput] = useState("");

  const {
    messages,
    status,
    setMessages,
    addToolResult: _addToolResult,
    error,
    sendMessage,
    stop,
  } = useChat({
    id: threadId,
    sendAutomaticallyWhen: (messages) => {
      // Image generation runs fully server-side — never auto-send after it
      // completes, otherwise the client would fire a second request and
      // re-generate the image indefinitely.
      if (appStore.getState().threadImageToolModel[threadId]) {
        return false;
      }
      return lastAssistantMessageIsCompleteWithToolCalls(messages);
    },
    transport: new DefaultChatTransport({
      prepareSendMessagesRequest: ({ messages, body, id }) => {
        if (window.location.pathname !== `/chat/${threadId}`) {
          console.log("replace-state");
          window.history.replaceState({}, "", `/chat/${threadId}`);
        }
        const lastMessage = messages.at(-1)!;
        // Filter out UI-only parts (e.g., source-url) so the model doesn't receive unknown parts
        const attachments: ChatAttachment[] = lastMessage.parts.reduce(
          (acc: ChatAttachment[], part: any) => {
            if (part?.type === "file") {
              acc.push({
                type: "file",
                url: part.url,
                mediaType: part.mediaType,
                filename: part.filename,
              });
            } else if (part?.type === "source-url") {
              acc.push({
                type: "source-url",
                url: part.url,
                mediaType: part.mediaType,
                filename: part.title,
              });
            }
            return acc;
          },
          [],
        );

        const sanitizedLastMessage = {
          ...lastMessage,
          parts: lastMessage.parts.filter((p: any) => p?.type !== "source-url"),
        } as typeof lastMessage;
        const hasFilePart = lastMessage.parts?.some(
          (p) => (p as any)?.type === "file",
        );

        const requestBody: ChatApiSchemaRequestBody = {
          ...body,
          id,
          chatModel:
            (body as { model: ChatModel })?.model ?? latestRef.current.model,
          toolChoice: latestRef.current.toolChoice,
          allowedAppDefaultToolkit:
            latestRef.current.mentions?.length || hasFilePart
              ? []
              : latestRef.current.allowedAppDefaultToolkit,
          allowedMcpServers: latestRef.current.mentions?.length
            ? {}
            : latestRef.current.allowedMcpServers,
          mentions: latestRef.current.mentions,
          message: sanitizedLastMessage,
          imageTool: latestRef.current.threadImageToolModel[threadId],
          attachments,
        };
        return { body: requestBody };
      },
    }),
    messages: initialMessages,
    generateId: generateUUID,
    experimental_throttle: 100,
    onFinish,
    onData: (part: any) => {
      if (part?.type === "data-compaction-status") {
        setIsCompactingContext(Boolean(part.data?.active));
        return;
      }

      if (part?.type === "data-compaction-checkpoint") {
        setCompactionCheckpoint({
          summaryText: String(part.data?.summaryText ?? ""),
          compactedMessageCount: Number(part.data?.compactedMessageCount ?? 0),
          summaryTokenCount: Number(part.data?.summaryTokenCount ?? 0),
        });
        const usedTokensAfterCompaction = Number(
          part.data?.usedTokensAfterCompaction ?? 0,
        );
        if (usedTokensAfterCompaction > 0) {
          setSessionCompactionBaseline({
            usedTokens: usedTokensAfterCompaction,
            messageCount: latestRef.current.messages.length,
          });
        }
        return;
      }

      if (part?.type === "data-citation-finalized") {
        const messageId =
          typeof part.data?.messageId === "string" ? part.data.messageId : null;
        const finalizedText =
          typeof part.data?.finalizedText === "string"
            ? part.data.finalizedText
            : null;
        if (!messageId || !finalizedText) {
          return;
        }

        startTransition(() => {
          setMessagesRef.current?.((currentMessages) =>
            currentMessages.map((currentMessage) =>
              currentMessage.id === messageId
                ? applyFinalizedAssistantText(
                    currentMessage,
                    finalizedText,
                    {
                      knowledgeCitations: Array.isArray(part.data?.citations)
                        ? part.data.citations
                        : undefined,
                    },
                    {
                      linkifyCitations: false,
                    },
                  )
                : currentMessage,
            ),
          );
        });
      }
    },
  });
  const [isDeleteThreadPopupOpen, setIsDeleteThreadPopupOpen] = useState(false);

  const addToolResult = useCallback(
    async (result: Parameters<typeof _addToolResult>[0]) => {
      await _addToolResult(result);
      // sendMessage();
    },
    [_addToolResult],
  );

  const mounted = useMounted();

  const latestRef = useToRef({
    toolChoice,
    model,
    allowedAppDefaultToolkit,
    allowedMcpServers,
    messages,
    threadId,
    mentions: threadMentions[threadId],
    threadImageToolModel,
  });
  setMessagesRef.current = setMessages;

  const isLoading = useMemo(
    () => status === "streaming" || status === "submitted",
    [status],
  );

  const emptyMessage = useMemo(
    () => messages.length === 0 && !error,
    [messages.length, error],
  );

  const isInitialThreadEntry = useMemo(
    () =>
      initialMessages.length > 0 &&
      initialMessages.at(-1)?.id === messages.at(-1)?.id,
    [messages],
  );

  const isPendingToolCall = useMemo(() => {
    if (status != "ready") return false;
    const lastMessage = messages.at(-1);
    if (lastMessage?.role != "assistant") return false;
    const lastPart = lastMessage.parts.at(-1);
    if (!lastPart) return false;
    if (!isToolUIPart(lastPart)) return false;
    if (lastPart.state.startsWith("output")) return false;
    return true;
  }, [status, messages]);

  const shouldShowCompactionStatusRow = isCompactingContext;

  const shouldShowPendingResponseRow = useMemo(() => {
    if (!isLoading || error) return false;
    const lastMessage = messages.at(-1);
    if (!lastMessage) return false;
    if (lastMessage.role === "user") return true;
    const hasStreamingText = lastMessage.parts.some(
      (part) =>
        part.type === "text" &&
        typeof part.text === "string" &&
        part.text.trim().length > 0 &&
        !(part as any).ingestionPreview,
    );
    if (!hasStreamingText) return true;
    return false;
  }, [error, isLoading, messages]);

  const particle = useMemo(() => {
    return (
      <AnimatePresence>
        {showParticles && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 5 }}
          >
            <div className="absolute top-0 left-0 w-full h-full z-10">
              <LightRays />
            </div>
            <div className="absolute top-0 left-0 w-full h-full z-10">
              <Particles particleCount={400} particleBaseSize={10} />
            </div>

            <div className="absolute top-0 left-0 w-full h-full z-10">
              <div className="w-full h-full bg-gradient-to-t from-background to-50% to-transparent z-20" />
            </div>
            <div className="absolute top-0 left-0 w-full h-full z-10">
              <div className="w-full h-full bg-gradient-to-l from-background to-20% to-transparent z-20" />
            </div>
            <div className="absolute top-0 left-0 w-full h-full z-10">
              <div className="w-full h-full bg-gradient-to-r from-background to-20% to-transparent z-20" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }, [showParticles]);

  const handleFocus = useCallback(() => {
    setShowParticles(false);
    debounce(() => setShowParticles(true), 60000);
  }, []);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const isScrollAtBottom = scrollHeight - scrollTop - clientHeight < 50;

    isAtBottomRef.current = isScrollAtBottom;
    setIsAtBottom(isScrollAtBottom);
    handleFocus();
  }, [handleFocus]);

  const scrollToBottom = useCallback(() => {
    containerRef.current?.scrollTo({
      top: containerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    if (pendingThreadMention && threadId) {
      appStoreMutate((prev) => ({
        threadMentions: {
          ...prev.threadMentions,
          [threadId]: [pendingThreadMention],
        },
        pendingThreadMention: undefined,
      }));
    }
  }, [pendingThreadMention, threadId, appStoreMutate]);

  useEffect(() => {
    if (isInitialThreadEntry)
      containerRef.current?.scrollTo({
        top: containerRef.current?.scrollHeight,
        behavior: "instant",
      });
  }, [isInitialThreadEntry]);

  useEffect(() => {
    if (isAtBottomRef.current) {
      containerRef.current?.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: "instant",
      });
    }
  }, [messages]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const messages = latestRef.current.messages;
      if (messages.length === 0) return;
      const isLastMessageCopy = isShortcutEvent(e, Shortcuts.lastMessageCopy);
      const isDeleteThread = isShortcutEvent(e, Shortcuts.deleteThread);
      if (!isDeleteThread && !isLastMessageCopy) return;
      e.preventDefault();
      e.stopPropagation();
      if (isLastMessageCopy) {
        const lastMessage = messages.at(-1);
        const lastMessageText = lastMessage!.parts
          .filter((part): part is TextUIPart => part.type == "text")
          ?.at(-1)?.text;
        if (!lastMessageText) return;
        navigator.clipboard.writeText(
          stripKnowledgeCitationLinks(lastMessageText),
        );
        toast.success("Last message copied to clipboard");
      }
      if (isDeleteThread) {
        setIsDeleteThreadPopupOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (mounted) {
      handleFocus();
    }
  }, [input, mounted, handleFocus]);

  useEffect(() => {
    if (mounted) {
      handleFocus();
    }
  }, [citationDocumentPreview, mounted, handleFocus]);

  useEffect(() => {
    return () => debounce.clear();
  }, []);

  return (
    <>
      {particle}
      <div className="flex h-full overflow-hidden">
        <div
          className={cn(
            emptyMessage && "justify-center pb-24",
            "flex flex-col min-w-0 relative flex-1 h-full z-40",
          )}
        >
          {isDragging && (
            <div className="absolute inset-0 z-40 bg-background/70 backdrop-blur-sm flex items-center justify-center pointer-events-none">
              <div className="rounded-2xl px-6 py-5 bg-background/80 shadow-xl border border-border flex items-center gap-3">
                <div className="rounded-full bg-primary/10 p-2 text-primary">
                  <FilePlus className="size-6" />
                </div>
                <span className="text-sm text-muted-foreground">
                  Drop files to upload
                </span>
              </div>
            </div>
          )}
          {emptyMessage ? (
            <ChatGreeting />
          ) : (
            <>
              <div
                className={
                  "flex flex-col gap-2 overflow-y-auto py-6 z-10 chat-minimal-scrollbar"
                }
                ref={containerRef}
                onScroll={handleScroll}
              >
                {messages.map((message, index) => {
                  const isLastMessage = messages.length - 1 === index;
                  const messageIsLoading =
                    isLastMessage && (isLoading || isPendingToolCall);
                  return (
                    <PreviewMessage
                      threadId={threadId}
                      messageIndex={index}
                      prevMessage={messages[index - 1]}
                      key={message.id}
                      message={message}
                      status={status}
                      addToolResult={addToolResult}
                      isLoading={messageIsLoading}
                      isLastMessage={isLastMessage}
                      setMessages={setMessages}
                      sendMessage={sendMessage}
                    />
                  );
                })}
                {shouldShowCompactionStatusRow && <CompactionStatusRow />}
                {shouldShowPendingResponseRow && <PendingResponseRow />}

                {error && <ErrorMessage error={error} />}
                <div className="min-w-0 min-h-52" />
              </div>
            </>
          )}

          <div
            className={clsx(
              messages.length && "absolute bottom-14",
              "w-full z-10",
            )}
          >
            <div className="max-w-3xl mx-auto relative flex justify-center items-center -top-2">
              <ScrollToBottomButton
                show={!isAtBottom && messages.length > 0}
                onClick={scrollToBottom}
              />
            </div>

            <PromptInput
              input={input}
              messages={messages}
              compactionCheckpoint={compactionCheckpoint}
              sessionCompactionBaseline={sessionCompactionBaseline}
              threadId={threadId}
              sendMessage={sendMessage}
              setInput={setInput}
              isLoading={isLoading || isPendingToolCall}
              onStop={stop}
              onFocus={isFirstTime ? undefined : handleFocus}
            />
          </div>
          <DeleteThreadPopup
            threadId={threadId}
            onClose={() => setIsDeleteThreadPopupOpen(false)}
            open={isDeleteThreadPopupOpen}
          />
        </div>
        <CitationPreviewPanel />
      </div>
    </>
  );
}

function PendingResponseRow() {
  return (
    <div className="w-full mx-auto max-w-3xl px-6">
      <div className="px-2 py-2">
        <Think />
      </div>
    </div>
  );
}

function CompactionStatusRow() {
  return (
    <div className="w-full mx-auto max-w-3xl px-6">
      <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-2 text-sm text-muted-foreground w-fit shadow-xs">
        <Loader className="size-3.5 animate-spin" />
        <span>Compacting context...</span>
      </div>
    </div>
  );
}

function DeleteThreadPopup({
  threadId,
  onClose,
  open,
}: { threadId: string; onClose: () => void; open: boolean }) {
  const t = useTranslations();
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();
  const handleDelete = useCallback(() => {
    setIsDeleting(true);
    safe(() => deleteThreadAction(threadId))
      .watch(() => setIsDeleting(false))
      .ifOk(() => {
        toast.success(t("Chat.Thread.threadDeleted"));
        router.push("/");
      })
      .ifFail(() => toast.error(t("Chat.Thread.failedToDeleteThread")))
      .watch(() => onClose());
  }, [threadId, router]);
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Chat.Thread.deleteChat")}</DialogTitle>
          <DialogDescription>
            {t("Chat.Thread.areYouSureYouWantToDeleteThisChatThread")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("Common.cancel")}
          </Button>
          <Button variant="destructive" onClick={handleDelete} autoFocus>
            {t("Common.delete")}
            {isDeleting && <Loader className="size-3.5 ml-2 animate-spin" />}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ScrollToBottomButtonProps {
  show: boolean;
  onClick: () => void;
  className?: string;
}

function ScrollToBottomButton({
  show,
  onClick,
  className,
}: ScrollToBottomButtonProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          className={className}
        >
          <Button
            onClick={onClick}
            className="shadow-lg backdrop-blur-sm border transition-colors"
            size="icon"
            variant="ghost"
          >
            <ArrowDown />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
