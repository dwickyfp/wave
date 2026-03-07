import { UploadedFile } from "@/app/store";
import {
  ChatContextPressureBreakdown,
  ChatMention,
  ChatThreadCompactionCheckpoint,
} from "app-types/chat";
import { UIMessage } from "ai";

const CHARS_PER_TOKEN = 4;
const INLINE_BINARY_PLACEHOLDER = "[inline-binary]";
const MIN_RESPONSE_BUDGET_TOKENS = 1024;
const MAX_RESPONSE_BUDGET_TOKENS = 4096;
const MIN_SUMMARY_BUDGET_TOKENS = 800;
const MAX_SUMMARY_BUDGET_TOKENS = 2000;
export const COMPACTED_HISTORY_TARGET_RATIO = 0.55;

interface EstimateChatContextTokensInput {
  messages?: UIMessage[];
  mentions?: ChatMention[];
  uploadedFiles?: Pick<
    UploadedFile,
    "name" | "mimeType" | "size" | "isUploading"
  >[];
  extraContext?: string;
  checkpoint?: Pick<
    ChatThreadCompactionCheckpoint,
    "summaryText" | "compactedMessageCount"
  > | null;
  contextLength?: number;
  maxPromptTokens?: number;
}

export interface ContextTurnBundle {
  startIndex: number;
  endIndex: number;
  messages: UIMessage[];
  tokenCount: number;
}

export interface DynamicTailSelection {
  bundles: ContextTurnBundle[];
  compactableMessages: UIMessage[];
  retainedMessages: UIMessage[];
  retainedBundleCount: number;
}

export function estimatePromptTokens(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;

  return Math.ceil(normalized.length / CHARS_PER_TOKEN);
}

export function estimateStructuredTokens(value: unknown): number {
  return estimatePromptTokens(serializeUnknown(value));
}

export function getResponseBudgetTokens(contextLength: number): number {
  return clampTokenBudget(Math.floor(contextLength * 0.15), {
    min: MIN_RESPONSE_BUDGET_TOKENS,
    max: MAX_RESPONSE_BUDGET_TOKENS,
  });
}

export function getSummaryBudgetTokens(contextLength: number): number {
  return clampTokenBudget(Math.floor(contextLength * 0.1), {
    min: MIN_SUMMARY_BUDGET_TOKENS,
    max: MAX_SUMMARY_BUDGET_TOKENS,
  });
}

export function estimateChatContextTokens(
  input: EstimateChatContextTokensInput,
): number {
  return estimateChatContextBreakdown(input).totalTokens;
}

export function estimateChatMessageHistoryTokens(
  messages?: UIMessage[],
): number {
  return estimatePromptTokens(serializeMessages(messages ?? []));
}

export function estimateChatContextBreakdown(
  input: EstimateChatContextTokensInput,
): ChatContextPressureBreakdown {
  const mentionsText = serializeMentions(input.mentions ?? []);
  const uploadedFilesText = serializeUploadedFiles(input.uploadedFiles ?? []);
  const extraContextText = input.extraContext?.trim()
    ? `Additional context:\n${input.extraContext.trim()}`
    : "";

  const history = buildEffectiveContextHistory(input.messages ?? [], {
    checkpoint: input.checkpoint,
    contextLength: input.contextLength,
    maxPromptTokens: input.maxPromptTokens,
    fixedOverheadTokens: estimatePromptTokens(
      [mentionsText, uploadedFilesText, extraContextText]
        .filter(Boolean)
        .join("\n\n"),
    ),
  });

  const sections = [
    history.summaryText?.trim()
      ? `Compacted history:\n${history.summaryText.trim()}`
      : "",
    serializeMessages(history.messages),
    mentionsText,
    uploadedFilesText,
    extraContextText,
  ].filter(Boolean);

  return {
    checkpointTokens: history.summaryText?.trim()
      ? estimatePromptTokens(history.summaryText)
      : 0,
    historyTokens: estimatePromptTokens(serializeMessages(history.messages)),
    mentionsTokens: estimatePromptTokens(mentionsText),
    uploadedFilesTokens: estimatePromptTokens(uploadedFilesText),
    extraContextTokens: estimatePromptTokens(extraContextText),
    totalTokens: estimatePromptTokens(sections.join("\n\n")),
    contextLength: input.contextLength,
  };
}

export function buildContextPressureBreakdownFromSections(input: {
  systemPrompt?: string;
  checkpointSummaryText?: string;
  historyMessages?: UIMessage[];
  knowledgeContexts?: string[];
  attachmentPreviewText?: string;
  currentTurn?: unknown;
  loopMessages?: unknown;
  toolTokens?: number;
  totalTokens?: number;
  contextLength?: number;
}): ChatContextPressureBreakdown {
  const systemPromptTokens = estimatePromptTokens(input.systemPrompt ?? "");
  const checkpointTokens = estimatePromptTokens(
    input.checkpointSummaryText ?? "",
  );
  const historyTokens = estimatePromptTokens(
    serializeMessages(input.historyMessages ?? []),
  );
  const knowledgeTokens = estimatePromptTokens(
    (input.knowledgeContexts ?? []).join("\n\n"),
  );
  const attachmentPreviewTokens = estimatePromptTokens(
    input.attachmentPreviewText ?? "",
  );
  const currentTurnTokens = estimateStructuredTokens(input.currentTurn ?? []);
  const loopTokens = estimateStructuredTokens(input.loopMessages ?? []);
  const toolTokens = input.toolTokens ?? 0;

  return {
    systemPromptTokens,
    checkpointTokens,
    historyTokens,
    knowledgeTokens,
    attachmentPreviewTokens,
    currentTurnTokens,
    loopTokens,
    toolTokens,
    totalTokens:
      input.totalTokens ??
      systemPromptTokens +
        checkpointTokens +
        historyTokens +
        knowledgeTokens +
        attachmentPreviewTokens +
        currentTurnTokens +
        loopTokens +
        toolTokens,
    contextLength: input.contextLength,
  };
}

export function buildTurnBundles(messages: UIMessage[]): ContextTurnBundle[] {
  const bundles: ContextTurnBundle[] = [];
  let currentMessages: UIMessage[] = [];
  let bundleStartIndex = 0;

  messages.forEach((message, index) => {
    if (message.role === "user" && currentMessages.length > 0) {
      bundles.push({
        startIndex: bundleStartIndex,
        endIndex: index - 1,
        messages: currentMessages,
        tokenCount: estimatePromptTokens(serializeMessages(currentMessages)),
      });
      currentMessages = [message];
      bundleStartIndex = index;
      return;
    }

    if (currentMessages.length === 0) {
      bundleStartIndex = index;
    }
    currentMessages.push(message);
  });

  if (currentMessages.length > 0) {
    bundles.push({
      startIndex: bundleStartIndex,
      endIndex: messages.length - 1,
      messages: currentMessages,
      tokenCount: estimatePromptTokens(serializeMessages(currentMessages)),
    });
  }

  return bundles;
}

export function selectDynamicTailMessages(input: {
  messages: UIMessage[];
  contextLength: number;
  fixedOverheadTokens: number;
  responseBudgetTokens?: number;
  summaryBudgetTokens?: number;
  maxPromptTokens?: number;
}): DynamicTailSelection {
  const responseBudgetTokens =
    input.responseBudgetTokens ?? getResponseBudgetTokens(input.contextLength);
  const summaryBudgetTokens =
    input.summaryBudgetTokens ?? getSummaryBudgetTokens(input.contextLength);
  const maxPromptTokens = input.maxPromptTokens ?? input.contextLength;
  const bundles = buildTurnBundles(input.messages);
  const availableTailBudget = Math.max(
    0,
    maxPromptTokens -
      input.fixedOverheadTokens -
      responseBudgetTokens -
      summaryBudgetTokens,
  );

  let retainedTokens = 0;
  let retainedBundleCount = 0;

  for (let index = bundles.length - 1; index >= 0; index -= 1) {
    const bundle = bundles[index];
    if (retainedTokens + bundle.tokenCount > availableTailBudget) {
      break;
    }
    retainedTokens += bundle.tokenCount;
    retainedBundleCount += 1;
  }

  if (retainedBundleCount === 0) {
    return {
      bundles,
      compactableMessages: input.messages,
      retainedMessages: [],
      retainedBundleCount: 0,
    };
  }

  const retainedBundles = bundles.slice(-retainedBundleCount);
  const retainedStartIndex =
    retainedBundles[0]?.startIndex ?? input.messages.length;

  return {
    bundles,
    compactableMessages: input.messages.slice(0, retainedStartIndex),
    retainedMessages: input.messages.slice(retainedStartIndex),
    retainedBundleCount,
  };
}

export function buildEffectiveContextHistory(
  messages: UIMessage[],
  options: {
    checkpoint?: Pick<
      ChatThreadCompactionCheckpoint,
      "summaryText" | "compactedMessageCount"
    > | null;
    contextLength?: number;
    fixedOverheadTokens?: number;
    maxPromptTokens?: number;
  },
): {
  messages: UIMessage[];
  summaryText?: string;
  compactedMessageCount: number;
} {
  const checkpoint = options.checkpoint;
  const compactedMessageCount = checkpoint?.compactedMessageCount ?? 0;
  const postCheckpointMessages = messages.slice(compactedMessageCount);

  if (!checkpoint?.summaryText?.trim()) {
    return {
      messages,
      compactedMessageCount: 0,
    };
  }

  if (!options.contextLength || options.contextLength < 1) {
    return {
      messages: postCheckpointMessages,
      summaryText: checkpoint.summaryText,
      compactedMessageCount,
    };
  }

  const selection = selectDynamicTailMessages({
    messages: postCheckpointMessages,
    contextLength: options.contextLength,
    fixedOverheadTokens: options.fixedOverheadTokens ?? 0,
    maxPromptTokens: options.maxPromptTokens,
  });

  return {
    messages: selection.retainedMessages,
    summaryText: checkpoint.summaryText,
    compactedMessageCount,
  };
}

export function serializeMessages(messages: UIMessage[]): string {
  return messages
    .map((message) => {
      const content = serializeMessage(message);
      if (!content.trim()) return "";

      return `${message.role}:\n${content}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

export function serializeMessage(message: UIMessage): string {
  const parts = Array.isArray(message.parts)
    ? message.parts
        .map((part) => serializeMessagePart(part))
        .filter((value) => value.length > 0)
    : [];

  const fallback = getMessageFallbackContent(message);
  return parts.length > 0 ? parts.join("\n\n") : fallback;
}

function getMessageFallbackContent(message: UIMessage): string {
  const maybeContent = (message as { content?: unknown }).content;
  return typeof maybeContent === "string" ? maybeContent : "";
}

function serializeMentions(mentions: ChatMention[]): string {
  if (!mentions.length) return "";

  const lines = mentions.map((mention) => {
    const identifier =
      mention.type === "agent"
        ? mention.agentId
        : mention.type === "workflow"
          ? mention.workflowId
          : mention.type === "knowledge"
            ? mention.knowledgeId
            : mention.type === "mcpServer" || mention.type === "mcpTool"
              ? mention.serverId
              : mention.name;

    return [mention.type, mention.name, mention.description ?? "", identifier]
      .filter(Boolean)
      .join(" ");
  });

  return `Mentions:\n${lines.join("\n")}`;
}

function serializeUploadedFiles(
  uploadedFiles: Pick<
    UploadedFile,
    "name" | "mimeType" | "size" | "isUploading"
  >[],
): string {
  if (!uploadedFiles.length) return "";

  const lines = uploadedFiles.map((file) =>
    [
      file.name,
      file.mimeType,
      file.size ? `${file.size} bytes` : "",
      file.isUploading ? "uploading" : "ready",
    ]
      .filter(Boolean)
      .join(" "),
  );

  return `Pending files:\n${lines.join("\n")}`;
}

export function serializeUnknown(
  value: unknown,
  seen = new WeakSet<object>(),
): string {
  if (value === null || value === undefined) return "";

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return sanitizeScalar(String(value));
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => serializeUnknown(item, seen))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value !== "object") return "";

  if (seen.has(value)) return "[circular]";
  seen.add(value);

  return Object.entries(value)
    .filter(([, entry]) => entry !== undefined && typeof entry !== "function")
    .map(([key, entry]) => {
      const serialized = serializeUnknown(entry, seen);
      return serialized ? `${key}: ${serialized}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function serializeMessagePart(part: unknown): string {
  if (!part || typeof part !== "object") {
    return serializeUnknown(part);
  }

  const type = (part as { type?: string }).type;
  if (!type) return serializeUnknown(part);
  if (type === "reasoning" || type === "step-start") return "";

  if (type === "source-url") {
    const source = part as {
      title?: string;
      url?: string;
      mediaType?: string;
    };

    return [source.title ?? "source", source.url ?? "", source.mediaType ?? ""]
      .filter(Boolean)
      .join(" ");
  }

  if (type === "file") {
    const file = part as {
      filename?: string;
      url?: string;
      mediaType?: string;
    };

    return [
      file.filename ?? "file",
      file.mediaType ?? "",
      file.url ? sanitizeScalar(file.url) : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  return serializeUnknown(part);
}

function sanitizeScalar(value: string): string {
  if (value.startsWith("data:")) {
    return INLINE_BINARY_PLACEHOLDER;
  }

  return value;
}

function clampTokenBudget(
  value: number,
  options: {
    min: number;
    max: number;
  },
): number {
  return Math.min(options.max, Math.max(options.min, value));
}
