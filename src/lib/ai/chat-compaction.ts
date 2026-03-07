import {
  convertToModelMessages,
  generateText,
  LanguageModel,
  ModelMessage,
  Output,
  Tool,
  UIMessage,
} from "ai";
import {
  ChatContextPressureBreakdown,
  ChatCompactionSummary,
  ChatModel,
  ChatThreadCompactionCheckpoint,
} from "app-types/chat";
import { z } from "zod";
import {
  buildEffectiveContextHistory,
  buildContextPressureBreakdownFromSections,
  COMPACTED_HISTORY_TARGET_RATIO,
  estimatePromptTokens,
  estimateStructuredTokens,
  getResponseBudgetTokens,
  getSummaryBudgetTokens,
  selectDynamicTailMessages,
  serializeMessages,
} from "./context-window";
import { ImageToolName } from "./tools";
import {
  sanitizeModelMessagesForProvider,
  shouldSendToolDefinitionsToProvider,
} from "./provider-compatibility";

export const CONTEXT_COMPACTION_TRIGGER_RATIO = 0.7;
export const CONTEXT_COMPACTION_TARGET_RATIO = COMPACTED_HISTORY_TARGET_RATIO;
export const CONTEXT_COMPACTION_HARD_RATIO = 0.85;
export const CONTEXT_COMPACTION_SCHEMA_VERSION = 1;
export const CONTEXT_COMPACTION_HARD_ERROR_MESSAGE =
  "Context window is still too full after compacting history. Reduce files, knowledge mentions, or tools and try again.";
const MIN_COMPACTION_SOURCE_TOKENS = 4_000;
const MAX_COMPACTION_SOURCE_TOKENS = 32_000;
const COMPACTION_SOURCE_PERCENT = 35;

const compactionItemSchema = z.object({
  source: z.string().trim().min(1),
  text: z.string().trim().min(1),
});

const compactionSummarySchema = z.object({
  conversationGoal: z.string().trim().default(""),
  userPreferences: z.array(compactionItemSchema).default([]),
  constraints: z.array(compactionItemSchema).default([]),
  establishedFacts: z.array(compactionItemSchema).default([]),
  decisions: z.array(compactionItemSchema).default([]),
  toolResults: z.array(compactionItemSchema).default([]),
  artifacts: z.array(compactionItemSchema).default([]),
  openQuestions: z.array(compactionItemSchema).default([]),
  nextActions: z.array(compactionItemSchema).default([]),
});

export type CompactionCheckpointDraft = Omit<
  ChatThreadCompactionCheckpoint,
  "id" | "threadId" | "createdAt" | "updatedAt"
>;

export type CompactionAssembly = {
  checkpoint: ChatThreadCompactionCheckpoint | null;
  systemPrompt: string;
  messages: ModelMessage[];
  totalTokens: number;
  compactableMessages: UIMessage[];
  retainedMessages: UIMessage[];
  removedToolParts: number;
  removedMessages: number;
  responseBudgetTokens: number;
  summaryBudgetTokens: number;
  sendToolDefinitions: boolean;
  toolTokens: number;
  currentLoopTokens: number;
  breakdown: ChatContextPressureBreakdown;
};

export async function buildCompactionAssembly(input: {
  persistedMessages: UIMessage[];
  currentMessage: UIMessage;
  currentLoopMessages?: ModelMessage[];
  checkpoint?: ChatThreadCompactionCheckpoint | null;
  contextLength: number;
  systemPrompt: string;
  provider?: string | null;
  tools: Record<string, Tool>;
  dynamicTailEnabled: boolean;
  knowledgeContexts?: string[];
  attachmentPreviewText?: string;
}): Promise<CompactionAssembly> {
  const currentLoopMessages = normalizeModelMessages(
    input.currentLoopMessages ?? [],
  );
  const currentMessageModelMessages = normalizeModelMessages(
    await convertToModelMessages([input.currentMessage]),
  );
  const sendToolDefinitions = shouldSendToolDefinitionsToProvider({
    provider: input.provider,
    tools: input.tools,
  });
  const toolTokens = sendToolDefinitions
    ? estimateToolDefinitionsTokens(input.tools)
    : 0;
  const responseBudgetTokens = getResponseBudgetTokens(input.contextLength);
  const summaryBudgetTokens = getSummaryBudgetTokens(input.contextLength);
  const currentLoopTokens = estimateStructuredTokens([
    currentMessageModelMessages,
    currentLoopMessages,
  ]);
  const fixedOverheadTokens =
    estimatePromptTokens(input.systemPrompt) + toolTokens + currentLoopTokens;
  const maxPromptTokens =
    input.contextLength > 0
      ? Math.floor(input.contextLength * CONTEXT_COMPACTION_TARGET_RATIO)
      : undefined;
  const postCheckpointMessages = input.persistedMessages.slice(
    input.checkpoint?.compactedMessageCount ?? 0,
  );
  const candidateSelection = selectDynamicTailMessages({
    messages: postCheckpointMessages,
    contextLength: input.contextLength,
    fixedOverheadTokens,
    responseBudgetTokens,
    summaryBudgetTokens,
    maxPromptTokens,
  });

  const persistedHistory = input.dynamicTailEnabled
    ? buildEffectiveContextHistory(input.persistedMessages, {
        checkpoint: input.checkpoint,
        contextLength: input.contextLength,
        fixedOverheadTokens,
        maxPromptTokens,
      })
    : {
        messages: postCheckpointMessages,
        summaryText: input.checkpoint?.summaryText,
        compactedMessageCount: input.checkpoint?.compactedMessageCount ?? 0,
      };

  const compactableMessages = candidateSelection.compactableMessages;

  const retainedMessages = persistedHistory.messages;
  const retainedModelMessages = normalizeModelMessages(
    await convertToModelMessages(retainedMessages),
  );
  const systemPrompt = persistedHistory.summaryText?.trim()
    ? `${input.systemPrompt}\n\n${renderCompactionMemoryBlock(persistedHistory.summaryText)}`
    : input.systemPrompt;
  const compatible = sanitizeModelMessagesForProvider({
    provider: input.provider,
    messages: [
      ...retainedModelMessages,
      ...currentMessageModelMessages,
      ...currentLoopMessages,
    ],
    tools: sendToolDefinitions ? input.tools : undefined,
  });

  const totalTokens =
    estimatePromptTokens(systemPrompt) +
    toolTokens +
    estimateStructuredTokens(compatible.messages);
  const breakdown = buildContextPressureBreakdownFromSections({
    systemPrompt: input.systemPrompt,
    checkpointSummaryText: persistedHistory.summaryText,
    historyMessages: retainedMessages,
    knowledgeContexts: input.knowledgeContexts,
    attachmentPreviewText: input.attachmentPreviewText,
    currentTurn: currentMessageModelMessages,
    loopMessages: currentLoopMessages,
    toolTokens,
    totalTokens,
    contextLength: input.contextLength,
  });

  return {
    checkpoint: input.checkpoint ?? null,
    systemPrompt,
    messages: compatible.messages,
    totalTokens,
    compactableMessages,
    retainedMessages,
    removedToolParts: compatible.removedToolParts,
    removedMessages: compatible.removedMessages,
    responseBudgetTokens,
    summaryBudgetTokens,
    sendToolDefinitions,
    toolTokens,
    currentLoopTokens,
    breakdown,
  };
}

export function buildPersistedHistoryCompactionCandidate(input: {
  persistedMessages: UIMessage[];
  checkpoint?: ChatThreadCompactionCheckpoint | null;
  contextLength: number;
}): {
  compactableMessages: UIMessage[];
  retainedMessages: UIMessage[];
  totalTokens: number;
  summaryText?: string;
  breakdown: ChatContextPressureBreakdown;
  summaryBudgetTokens: number;
} {
  const responseBudgetTokens = getResponseBudgetTokens(input.contextLength);
  const summaryBudgetTokens = getSummaryBudgetTokens(input.contextLength);
  const maxPromptTokens =
    input.contextLength > 0
      ? Math.floor(input.contextLength * CONTEXT_COMPACTION_TARGET_RATIO)
      : undefined;
  const postCheckpointMessages = input.persistedMessages.slice(
    input.checkpoint?.compactedMessageCount ?? 0,
  );
  const candidateSelection = selectDynamicTailMessages({
    messages: postCheckpointMessages,
    contextLength: input.contextLength,
    fixedOverheadTokens: 0,
    responseBudgetTokens,
    summaryBudgetTokens,
    maxPromptTokens,
  });
  const persistedHistory = buildEffectiveContextHistory(
    input.persistedMessages,
    {
      checkpoint: input.checkpoint,
      contextLength: input.contextLength,
      fixedOverheadTokens: 0,
      maxPromptTokens,
    },
  );
  const breakdown = buildContextPressureBreakdownFromSections({
    checkpointSummaryText: persistedHistory.summaryText,
    historyMessages: persistedHistory.messages,
    totalTokens:
      estimatePromptTokens(persistedHistory.summaryText ?? "") +
      estimatePromptTokens(serializeMessages(persistedHistory.messages)),
    contextLength: input.contextLength,
  });

  return {
    compactableMessages: candidateSelection.compactableMessages,
    retainedMessages: persistedHistory.messages,
    totalTokens: breakdown.totalTokens,
    summaryText: persistedHistory.summaryText,
    breakdown,
    summaryBudgetTokens,
  };
}

export async function generateCompactionCheckpoint(input: {
  model: LanguageModel;
  chatModel?: ChatModel | null;
  checkpoint?: ChatThreadCompactionCheckpoint | null;
  compactableMessages: UIMessage[];
  summaryBudgetTokens: number;
  contextLength?: number;
  abortSignal?: AbortSignal;
}): Promise<CompactionCheckpointDraft> {
  const emptySummary: ChatCompactionSummary = {
    conversationGoal: "",
    userPreferences: [],
    constraints: [],
    establishedFacts: [],
    decisions: [],
    toolResults: [],
    artifacts: [],
    openQuestions: [],
    nextActions: [],
  };
  const sourceText = serializeMessagesForCompaction(input.compactableMessages);
  const sourceTokenCount = estimatePromptTokens(sourceText);

  if (!sourceText.trim()) {
    const summaryText = input.checkpoint?.summaryText?.trim() ?? "";
    return {
      schemaVersion: CONTEXT_COMPACTION_SCHEMA_VERSION,
      summaryJson: input.checkpoint?.summaryJson ?? emptySummary,
      summaryText,
      compactedMessageCount:
        (input.checkpoint?.compactedMessageCount ?? 0) +
        input.compactableMessages.length,
      sourceTokenCount,
      summaryTokenCount: estimatePromptTokens(summaryText),
      modelProvider: input.chatModel?.provider ?? "unknown",
      modelName: input.chatModel?.model ?? "unknown",
    };
  }

  const budgetSequence = buildCompactionSourceTokenBudgetSequence({
    contextLength: input.contextLength,
    summaryBudgetTokens: input.summaryBudgetTokens,
  });

  let rollingSummaryText = input.checkpoint?.summaryText?.trim();
  let verified: ChatCompactionSummary =
    input.checkpoint?.summaryJson ?? emptySummary;
  let lastError: unknown = null;

  for (const tokenBudget of budgetSequence) {
    const sourceChunks = splitCompactionSourceText({
      sourceText,
      tokenBudget,
    });
    rollingSummaryText = input.checkpoint?.summaryText?.trim();
    verified = input.checkpoint?.summaryJson ?? emptySummary;

    try {
      for (const chunk of sourceChunks) {
        const summary = await summarizeCompactionSource({
          model: input.model,
          existingSummaryText: rollingSummaryText,
          sourceText: chunk,
          summaryBudgetTokens: input.summaryBudgetTokens,
          abortSignal: input.abortSignal,
        });

        verified = await verifyCompactionSummary({
          model: input.model,
          existingSummaryText: rollingSummaryText,
          sourceText: chunk,
          draftSummary: summary,
          summaryBudgetTokens: input.summaryBudgetTokens,
          abortSignal: input.abortSignal,
        });

        rollingSummaryText = renderCompactionSummaryText(
          verified,
          input.summaryBudgetTokens,
        );
      }

      lastError = null;
      break;
    } catch (error) {
      try {
        rollingSummaryText = input.checkpoint?.summaryText?.trim();
        for (const chunk of sourceChunks) {
          const draftSummaryText = await summarizeCompactionSourceAsText({
            model: input.model,
            existingSummaryText: rollingSummaryText,
            sourceText: chunk,
            summaryBudgetTokens: input.summaryBudgetTokens,
            abortSignal: input.abortSignal,
          });

          rollingSummaryText = await verifyCompactionSummaryText({
            model: input.model,
            existingSummaryText: rollingSummaryText,
            sourceText: chunk,
            draftSummaryText,
            summaryBudgetTokens: input.summaryBudgetTokens,
            abortSignal: input.abortSignal,
          });
        }

        verified = plainTextSummaryToStructuredSummary(
          rollingSummaryText ?? "",
          emptySummary,
        );
        lastError = null;
        break;
      } catch (fallbackError) {
        lastError = fallbackError ?? error;
      }
    }
  }

  if (lastError) {
    rollingSummaryText = buildDeterministicCompactionSummaryText({
      existingSummaryText: input.checkpoint?.summaryText?.trim(),
      sourceText,
      tokenBudget: input.summaryBudgetTokens,
    });
    verified = plainTextSummaryToStructuredSummary(
      rollingSummaryText,
      emptySummary,
    );
  }

  const summaryText = rollingSummaryText ?? "";

  return {
    schemaVersion: CONTEXT_COMPACTION_SCHEMA_VERSION,
    summaryJson: verified,
    summaryText,
    compactedMessageCount:
      (input.checkpoint?.compactedMessageCount ?? 0) +
      input.compactableMessages.length,
    sourceTokenCount,
    summaryTokenCount: estimatePromptTokens(summaryText),
    modelProvider: input.chatModel?.provider ?? "unknown",
    modelName: input.chatModel?.model ?? "unknown",
  };
}

export async function buildChatStreamSeedMessages(
  currentMessage: UIMessage,
): Promise<ModelMessage[]> {
  const converted = normalizeModelMessages(
    await convertToModelMessages([currentMessage]),
  );

  if (converted.length > 0) {
    return converted;
  }

  return [
    {
      role: "user",
      content: [{ type: "text", text: "Continue the conversation." }],
    },
  ];
}

export function stripAttachmentPreviewParts(message: UIMessage): UIMessage {
  return {
    ...message,
    parts: (message.parts ?? []).filter(
      (part: any) => !(part && part.ingestionPreview === true),
    ),
  };
}

export function stripAttachmentPreviewPartsFromMessages(
  messages: UIMessage[],
): UIMessage[] {
  return messages.map(stripAttachmentPreviewParts);
}

export function serializeMessagesForCompaction(messages: UIMessage[]): string {
  return messages
    .map((message) => {
      const content = serializeCompactionMessage(message);
      if (!content.trim()) return "";
      return `${message.role}:\n${content}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

export function extractAttachmentPreviewText(messages: UIMessage[]): string {
  return messages
    .flatMap((message) =>
      (message.parts ?? [])
        .filter((part: any) => part?.ingestionPreview === true)
        .map((part: any) => String(part?.text ?? "").trim())
        .filter(Boolean),
    )
    .join("\n\n");
}

export function collectUsedToolNamesFromModelMessages(
  messages: ModelMessage[],
): Set<string> {
  const usedToolNames = new Set<string>();

  for (const message of messages) {
    if (!Array.isArray((message as { content?: unknown }).content)) continue;
    for (const part of (message as { content: any[] }).content) {
      if (
        part?.type === "tool-call" ||
        part?.type === "tool-result" ||
        part?.type === "tool-approval-request"
      ) {
        if (part.toolName) {
          usedToolNames.add(part.toolName);
        }
      }
    }
  }

  return usedToolNames;
}

export function renderCompactionMemoryBlock(summaryText: string): string {
  return [
    "Compressed conversation memory:",
    "Use this as earlier history. If it conflicts with newer raw messages or the current user turn, trust the newer raw messages.",
    summaryText.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function estimateToolDefinitionsTokens(
  tools: Record<string, Tool>,
): number {
  const summary = Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
  return estimateStructuredTokens(summary);
}

export function getCompactionSourceTokenBudget(input: {
  contextLength?: number;
  summaryBudgetTokens: number;
}): number {
  if (!input.contextLength || input.contextLength < 1) {
    return Math.max(
      MIN_COMPACTION_SOURCE_TOKENS,
      input.summaryBudgetTokens * 4,
    );
  }

  return Math.max(
    MIN_COMPACTION_SOURCE_TOKENS,
    Math.min(
      MAX_COMPACTION_SOURCE_TOKENS,
      Math.floor((input.contextLength * COMPACTION_SOURCE_PERCENT) / 100),
    ),
  );
}

export function buildCompactionSourceTokenBudgetSequence(input: {
  contextLength?: number;
  summaryBudgetTokens: number;
}): number[] {
  const initialBudget = getCompactionSourceTokenBudget(input);
  const budgets = new Set<number>([initialBudget]);
  let nextBudget = initialBudget;

  while (nextBudget > MIN_COMPACTION_SOURCE_TOKENS) {
    nextBudget = Math.max(
      MIN_COMPACTION_SOURCE_TOKENS,
      Math.floor(nextBudget / 2),
    );
    budgets.add(nextBudget);
    if (nextBudget === MIN_COMPACTION_SOURCE_TOKENS) {
      break;
    }
  }

  return Array.from(budgets);
}

export function splitCompactionSourceText(input: {
  sourceText: string;
  tokenBudget: number;
}): string[] {
  const normalizedSource = input.sourceText.trim();
  if (!normalizedSource) {
    return [];
  }

  if (estimatePromptTokens(normalizedSource) <= input.tokenBudget) {
    return [normalizedSource];
  }

  const chunks: string[] = [];
  const sections = normalizedSource
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean);
  let currentChunk = "";

  const pushChunk = (value: string) => {
    const normalized = value.trim();
    if (normalized) {
      chunks.push(normalized);
    }
  };

  for (const section of sections) {
    const candidate = currentChunk ? `${currentChunk}\n\n${section}` : section;

    if (estimatePromptTokens(candidate) <= input.tokenBudget) {
      currentChunk = candidate;
      continue;
    }

    if (currentChunk) {
      pushChunk(currentChunk);
      currentChunk = "";
    }

    if (estimatePromptTokens(section) <= input.tokenBudget) {
      currentChunk = section;
      continue;
    }

    const oversizedChunks = splitOversizedCompactionSection(
      section,
      input.tokenBudget,
    );
    for (const oversizedChunk of oversizedChunks) {
      pushChunk(oversizedChunk);
    }
  }

  if (currentChunk) {
    pushChunk(currentChunk);
  }

  return chunks;
}

function normalizeModelMessages(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== "tool") return message;

    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== "tool-result") return part;
        if (part.toolName !== ImageToolName) return part;
        const output = part.output;
        if (output.type !== "json") return part;

        const value = output.value as Record<string, unknown>;
        return {
          ...part,
          output: {
            type: "text" as const,
            value: (value?.guide as string) ?? "Image generated.",
          },
        };
      }),
    };
  });
}

function serializeCompactionMessage(message: UIMessage): string {
  const textParts = Array.isArray(message.parts)
    ? message.parts
        .filter(
          (part: any) =>
            part?.type === "text" &&
            typeof part?.text === "string" &&
            part?.ingestionPreview !== true,
        )
        .map((part: any) => String(part.text).trim())
        .filter(Boolean)
    : [];

  return textParts.join("\n\n");
}

async function summarizeCompactionSource(input: {
  model: LanguageModel;
  existingSummaryText?: string;
  sourceText: string;
  summaryBudgetTokens: number;
  abortSignal?: AbortSignal;
}): Promise<ChatCompactionSummary> {
  const { experimental_output: output } = await generateText({
    model: input.model,
    abortSignal: input.abortSignal,
    system:
      "You compress prior chat history into structured working memory. Preserve only concrete user goals, preferences, constraints, facts, decisions, tool results, artifacts, open questions, and next actions. Do not invent facts. Do not include reasoning traces.",
    prompt: [
      `Target rendered summary budget: about ${input.summaryBudgetTokens} tokens.`,
      input.existingSummaryText
        ? `Existing memory:\n${input.existingSummaryText}`
        : "",
      `Conversation span to compact:\n${input.sourceText}`,
      "Return dense, factual structured memory. Use source labels like user, assistant, system, or tool:<name>.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    experimental_output: Output.object({ schema: compactionSummarySchema }),
    maxOutputTokens: getCompactionOutputTokenLimit(input.summaryBudgetTokens),
    providerOptions: buildNoReasoningProviderOptions() as any,
  });

  return output as ChatCompactionSummary;
}

async function verifyCompactionSummary(input: {
  model: LanguageModel;
  existingSummaryText?: string;
  sourceText: string;
  draftSummary: ChatCompactionSummary;
  summaryBudgetTokens: number;
  abortSignal?: AbortSignal;
}): Promise<ChatCompactionSummary> {
  const { experimental_output: output } = await generateText({
    model: input.model,
    abortSignal: input.abortSignal,
    system:
      "You verify and repair structured conversation memory. Fix omissions, contradictions, or invented details. Keep only information grounded in the supplied source.",
    prompt: [
      `Keep the repaired summary within about ${input.summaryBudgetTokens} rendered tokens.`,
      input.existingSummaryText
        ? `Existing memory before repair:\n${input.existingSummaryText}`
        : "",
      `Source conversation span:\n${input.sourceText}`,
      `Draft structured memory:\n${JSON.stringify(input.draftSummary)}`,
      "Return the corrected structured memory. Preserve every important fact needed to continue the chat accurately.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    experimental_output: Output.object({ schema: compactionSummarySchema }),
    maxOutputTokens: getCompactionOutputTokenLimit(input.summaryBudgetTokens),
    providerOptions: buildNoReasoningProviderOptions() as any,
  });

  return output as ChatCompactionSummary;
}

function renderCompactionSummaryText(
  summary: ChatCompactionSummary,
  tokenBudget: number,
): string {
  const sections = [
    {
      title: "Conversation goal",
      lines: summary.conversationGoal?.trim()
        ? [summary.conversationGoal.trim()]
        : [],
    },
    {
      title: "User preferences",
      lines: renderCompactionItems(summary.userPreferences),
    },
    {
      title: "Constraints",
      lines: renderCompactionItems(summary.constraints),
    },
    {
      title: "Established facts",
      lines: renderCompactionItems(summary.establishedFacts),
    },
    {
      title: "Decisions",
      lines: renderCompactionItems(summary.decisions),
    },
    {
      title: "Tool results",
      lines: renderCompactionItems(summary.toolResults),
    },
    {
      title: "Artifacts",
      lines: renderCompactionItems(summary.artifacts),
    },
    {
      title: "Open questions",
      lines: renderCompactionItems(summary.openQuestions),
    },
    {
      title: "Next actions",
      lines: renderCompactionItems(summary.nextActions),
    },
  ];

  const result: string[] = [];

  for (const section of sections) {
    if (section.lines.length === 0) continue;
    const nextSection = [`${section.title}:`, ...section.lines];
    const candidate = [...result, ...nextSection].join("\n");
    if (estimatePromptTokens(candidate) > tokenBudget && result.length > 0) {
      break;
    }

    result.push(...nextSection);
  }

  const text = result.join("\n").trim();
  if (estimatePromptTokens(text) <= tokenBudget) {
    return text;
  }

  const trimmed: string[] = [];
  for (const line of result) {
    const candidate = [...trimmed, line].join("\n");
    if (estimatePromptTokens(candidate) > tokenBudget) break;
    trimmed.push(line);
  }

  return trimmed.join("\n").trim();
}

function renderCompactionItems(
  items: {
    source: string;
    text: string;
  }[],
): string[] {
  return items
    .map((item) => {
      const source = item.source.trim();
      const text = item.text.trim();
      if (!source || !text) return "";
      return `- [${source}] ${text}`;
    })
    .filter(Boolean);
}

function buildNoReasoningProviderOptions(): Record<string, unknown> {
  return {
    openrouter: {
      reasoning: { effort: "none", exclude: true },
    },
    google: { thinkingConfig: { thinkingBudget: 0 } },
    openai: { reasoningEffort: "none" },
    anthropic: { thinking: { type: "disabled" } },
  };
}

async function summarizeCompactionSourceAsText(input: {
  model: LanguageModel;
  existingSummaryText?: string;
  sourceText: string;
  summaryBudgetTokens: number;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const { text } = await generateText({
    model: input.model,
    abortSignal: input.abortSignal,
    system:
      "You compress prior chat history into concise working memory. Preserve only concrete user goals, preferences, constraints, facts, decisions, open questions, and next actions. Do not include tool payloads, file dumps, or reasoning traces.",
    prompt: [
      `Keep the updated memory within about ${input.summaryBudgetTokens} tokens.`,
      input.existingSummaryText
        ? `Existing memory:\n${input.existingSummaryText}`
        : "",
      `Conversation span to compact:\n${input.sourceText}`,
      "Return only the updated compact memory as plain text. Prefer short headed notes and bullets.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxOutputTokens: getCompactionOutputTokenLimit(input.summaryBudgetTokens),
    providerOptions: buildNoReasoningProviderOptions() as any,
  });

  return trimPlainTextCompactionSummary(text, input.summaryBudgetTokens);
}

async function verifyCompactionSummaryText(input: {
  model: LanguageModel;
  existingSummaryText?: string;
  sourceText: string;
  draftSummaryText: string;
  summaryBudgetTokens: number;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const { text } = await generateText({
    model: input.model,
    abortSignal: input.abortSignal,
    system:
      "You verify and repair compact conversation memory. Fix omissions, contradictions, or invented details. Keep only facts grounded in the supplied source conversation.",
    prompt: [
      `Keep the repaired memory within about ${input.summaryBudgetTokens} tokens.`,
      input.existingSummaryText
        ? `Existing memory before repair:\n${input.existingSummaryText}`
        : "",
      `Source conversation span:\n${input.sourceText}`,
      `Draft compact memory:\n${input.draftSummaryText}`,
      "Return only the corrected compact memory as plain text.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxOutputTokens: getCompactionOutputTokenLimit(input.summaryBudgetTokens),
    providerOptions: buildNoReasoningProviderOptions() as any,
  });

  return trimPlainTextCompactionSummary(text, input.summaryBudgetTokens);
}

function getCompactionOutputTokenLimit(summaryBudgetTokens: number): number {
  return Math.max(256, Math.min(summaryBudgetTokens * 2, 4_096));
}

function trimPlainTextCompactionSummary(
  text: string,
  tokenBudget: number,
): string {
  const normalized = text.trim();
  if (!normalized) return "";

  if (estimatePromptTokens(normalized) <= tokenBudget) {
    return normalized;
  }

  const lines = normalized.split("\n").map((line) => line.trimEnd());
  const keptLines: string[] = [];

  for (const line of lines) {
    const candidate = [...keptLines, line].join("\n").trim();
    if (estimatePromptTokens(candidate) > tokenBudget) {
      break;
    }
    keptLines.push(line);
  }

  return keptLines.join("\n").trim();
}

function plainTextSummaryToStructuredSummary(
  text: string,
  emptySummary: ChatCompactionSummary,
): ChatCompactionSummary {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 64);

  if (lines.length === 0) {
    return emptySummary;
  }

  return {
    ...emptySummary,
    establishedFacts: lines.map((line) => ({
      source: "summary",
      text: line.replace(/^[-*]\s*/, ""),
    })),
  };
}

function buildDeterministicCompactionSummaryText(input: {
  existingSummaryText?: string;
  sourceText: string;
  tokenBudget: number;
}): string {
  const blocks = input.sourceText
    .split(/\n{2,}(?=(?:user|assistant|system):\n)/)
    .map((block) => block.trim())
    .filter(Boolean);
  const existingSection = trimPlainTextCompactionSummary(
    input.existingSummaryText ?? "",
    Math.max(0, Math.floor(input.tokenBudget * 0.45)),
  );

  const transcriptLines = blocks.map((block) => {
    const [header, ...rest] = block.split("\n");
    const role = header.replace(/:$/, "").trim();
    const content = rest.join(" ").replace(/\s+/g, " ").trim();
    const snippet =
      content.length > 240 ? `${content.slice(0, 237)}...` : content;
    return snippet ? `[${role}] ${snippet}` : "";
  });

  const selectedLines: string[] = [];
  const startLines = transcriptLines.slice(0, 2).filter(Boolean);
  const endLines = transcriptLines.slice(-8).filter(Boolean);

  selectedLines.push(...startLines);
  if (transcriptLines.length > startLines.length + endLines.length) {
    selectedLines.push("[...]");
  }
  for (const line of endLines) {
    if (!selectedLines.includes(line)) {
      selectedLines.push(line);
    }
  }

  const newSection = trimPlainTextCompactionSummary(
    selectedLines.join("\n"),
    Math.max(0, input.tokenBudget - estimatePromptTokens(existingSection)),
  );

  return trimPlainTextCompactionSummary(
    [
      existingSection ? `Earlier memory:\n${existingSection}` : "",
      newSection ? `Compacted transcript:\n${newSection}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    input.tokenBudget,
  );
}

function splitOversizedCompactionSection(
  section: string,
  tokenBudget: number,
): string[] {
  const maxChars = Math.max(1_000, tokenBudget * 4);
  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < section.length) {
    const remaining = section.slice(cursor);
    if (estimatePromptTokens(remaining) <= tokenBudget) {
      chunks.push(remaining.trim());
      break;
    }

    const slice = section.slice(cursor, cursor + maxChars);
    const breakIndex = findCompactionBreakIndex(slice);
    const nextChunk = section.slice(cursor, cursor + breakIndex).trim();
    chunks.push(nextChunk);
    cursor += Math.max(1, breakIndex);
  }

  return chunks.filter(Boolean);
}

function findCompactionBreakIndex(text: string): number {
  const candidates = [
    text.lastIndexOf("\n\n"),
    text.lastIndexOf("\n"),
    text.lastIndexOf(". "),
    text.lastIndexOf(" "),
  ].filter((index) => index > Math.floor(text.length * 0.5));

  if (candidates.length > 0) {
    return Math.max(...candidates);
  }

  return text.length;
}
