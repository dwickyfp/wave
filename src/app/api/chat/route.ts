import {
  ModelMessage,
  Tool,
  consumeStream,
  UIMessage,
  createUIMessageStream,
  createUIMessageStreamResponse,
  smoothStream,
  stepCountIs,
  streamText,
} from "ai";

import { getDbModel } from "lib/ai/provider-factory";

import {
  ChatContextPressureBreakdown,
  ChatMention,
  ChatMetadata,
  ChatThreadCompactionCheckpoint,
  ChatUsage,
  chatApiSchemaRequestBodySchema,
} from "app-types/chat";
import {
  agentRepository,
  a2aAgentRepository,
  chatRepository,
  knowledgeRepository,
  settingsRepository,
  snowflakeAgentRepository,
} from "lib/db/repository";
import globalLogger from "logger";

import { safe } from "ts-safe";

import { getSession } from "auth/server";
import { colorize } from "consola/utils";
import {
  buildWaveAgentSystemPrompt,
  loadWaveAgentBoundTools,
} from "lib/ai/agent/runtime";
import { ImageToolName } from "lib/ai/tools";
import { createDbImageTool } from "lib/ai/tools/image";
import {
  queryKnowledgeAsDocs,
  formatDocsAsText,
} from "lib/knowledge/retriever";
import {
  allocateSequentialKnowledgeTokens,
  CHAT_KNOWLEDGE_CONTEXT_TOKENS,
  estimateKnowledgePromptTokens,
} from "lib/knowledge/token-budget";
import {
  type SnowflakeCortexMessage,
  callSnowflakeCortexStream,
  createSnowflakeThread,
} from "lib/snowflake/client";
import { streamA2AAgentResponse } from "lib/a2a/client";
import { generateUUID } from "lib/utils";
import { buildUsageCostSnapshot } from "lib/ai/usage-cost";
import { shouldSendToolDefinitionsToProvider } from "lib/ai/provider-compatibility";
import {
  buildCompactionAssembly,
  buildChatStreamSeedMessages,
  collectUsedToolNamesFromModelMessages,
  CONTEXT_COMPACTION_HARD_ERROR_MESSAGE,
  CONTEXT_COMPACTION_HARD_RATIO,
  CONTEXT_COMPACTION_TARGET_RATIO,
  CONTEXT_COMPACTION_TRIGGER_RATIO,
  extractAttachmentPreviewText,
  generateCompactionCheckpoint,
  stripAttachmentPreviewParts,
  stripAttachmentPreviewPartsFromMessages,
} from "lib/ai/chat-compaction";
import { updateThreadCompactionState } from "lib/ai/chat-compaction-background";
import {
  rememberAgentAction,
  rememberMcpServerCustomizationsAction,
} from "./actions";
import { recordSelfLearningSignal } from "lib/self-learning/service";
import { getLearnedPersonalizationPromptForUser } from "lib/self-learning/runtime";
import {
  convertToSavePart,
  excludeToolExecution,
  extractInProgressToolPart,
  filterMcpServerCustomizations,
  handleError,
  manualToolExecuteByLastMessage,
} from "./shared.chat";
import { appendAbortedResponseNotice } from "lib/ai/append-aborted-response-notice";
import {
  applyChatAttachmentsToMessage,
  ensureUserChatThread,
} from "lib/chat/chat-session";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `Chat API: `),
});

const KNOWLEDGE_CONTEXT_BUDGET_STAGES = [
  CHAT_KNOWLEDGE_CONTEXT_TOKENS,
  2500,
  1200,
  0,
];

function buildCompactionFailureMessage(input: {
  failureCode?: string;
  breakdown: ChatContextPressureBreakdown;
}) {
  const segments = [
    { label: "history", value: input.breakdown?.historyTokens },
    { label: "knowledge", value: input.breakdown?.knowledgeTokens },
    { label: "tools", value: input.breakdown?.toolTokens },
    { label: "current", value: input.breakdown?.currentTurnTokens },
    { label: "files", value: input.breakdown?.attachmentPreviewTokens },
  ]
    .filter((segment) => (segment.value ?? 0) > 0)
    .map((segment) => `${segment.label} ${segment.value}`);

  if (segments.length === 0 && !input.failureCode) {
    return CONTEXT_COMPACTION_HARD_ERROR_MESSAGE;
  }

  return [
    CONTEXT_COMPACTION_HARD_ERROR_MESSAGE,
    input.failureCode ? `code: ${input.failureCode}` : "",
    segments.length ? `breakdown: ${segments.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function POST(request: Request) {
  try {
    const json = await request.json();

    const session = await getSession();

    if (!session?.user.id) {
      return new Response("Unauthorized", { status: 401 });
    }
    const {
      id,
      message,
      chatModel,
      toolChoice,
      allowedAppDefaultToolkit,
      allowedMcpServers,
      imageTool,
      mentions = [],
      attachments = [],
    } = chatApiSchemaRequestBodySchema.parse(json);

    const dbModelResult = await getDbModel(chatModel!);
    if (!dbModelResult) {
      return Response.json(
        {
          message: `Model "${chatModel?.model}" is not configured. Please set it up in Settings → AI Providers.`,
        },
        { status: 503 },
      );
    }
    const model = dbModelResult.model;
    const attachUsageCost = (usage: ChatUsage): ChatUsage => ({
      ...usage,
      ...buildUsageCostSnapshot(usage, {
        inputTokenPricePer1MUsd: dbModelResult.inputTokenPricePer1MUsd,
        outputTokenPricePer1MUsd: dbModelResult.outputTokenPricePer1MUsd,
      }),
    });

    let thread;
    try {
      thread = await ensureUserChatThread({
        threadId: id,
        userId: session.user.id,
      });
    } catch (error) {
      if ((error as Error).message === "Forbidden") {
        return new Response("Forbidden", { status: 403 });
      }
      throw error;
    }

    const messages: UIMessage[] = (thread?.messages ?? []).map((m) => {
      return {
        id: m.id,
        role: m.role,
        parts: m.parts,
        metadata: m.metadata,
      };
    });

    if (messages.at(-1)?.id == message.id) {
      messages.pop();
    }
    await applyChatAttachmentsToMessage({
      message,
      attachments,
      userId: session.user.id,
    });

    const persistedMessages = [...messages];
    const previousAssistantMessage = [...persistedMessages]
      .reverse()
      .find((persistedMessage) => persistedMessage.role === "assistant");
    if (message.role === "user" && previousAssistantMessage) {
      await recordSelfLearningSignal({
        userId: session.user.id,
        threadId: thread?.id ?? null,
        messageId: previousAssistantMessage.id,
        signalType: "follow_up_continue",
        payload: {
          source: "chat_follow_up",
        },
      }).catch(() => {});
    }
    messages.push(message);

    const supportToolCall = dbModelResult.supportsTools;

    const agentId = (
      mentions.find((m) => m.type === "agent") as Extract<
        ChatMention,
        { type: "agent" }
      >
    )?.agentId;

    const agent = await rememberAgentAction(agentId, session.user.id);

    // ── Snowflake Intelligence intercept ────────────────────────────────────
    // When the agent is a Snowflake Cortex agent, bypass the LLM entirely and
    // proxy the conversation directly to the Snowflake Cortex Agent API.
    if ((agent as any)?.agentType === "snowflake_cortex") {
      const sfConfig =
        await snowflakeAgentRepository.selectSnowflakeConfigByAgentId(
          agent!.id,
        );

      if (!sfConfig) {
        return Response.json(
          { message: "Snowflake configuration not found for this agent" },
          { status: 404 },
        );
      }

      // ── Thread management ────────────────────────────────────────────────
      // Each Wave chat session maps to exactly one Snowflake Cortex thread so
      // Snowflake owns the conversation history.  On the first turn we create
      // a new thread; on subsequent turns we reuse the existing thread_id and
      // advance parent_message_id to the last successful assistant message.
      let sfThreadId: string | undefined =
        thread?.snowflakeThreadId ?? undefined;
      let sfParentMessageId: number = thread?.snowflakeParentMessageId ?? 0;

      if (!sfThreadId) {
        sfThreadId = await createSnowflakeThread(sfConfig);
        sfParentMessageId = 0;
        // Persist immediately so the next turn can pick it up even if this
        // one fails partway through.
        await chatRepository.updateThread(thread!.id, {
          snowflakeThreadId: sfThreadId,
          snowflakeParentMessageId: 0,
        });
        logger.info(
          `Created Snowflake thread ${sfThreadId} for Wave session ${thread!.id}`,
        );
      } else {
        logger.info(
          `Reusing Snowflake thread ${sfThreadId} (parent_message_id=${sfParentMessageId}) for Wave session ${thread!.id}`,
        );
      }

      // Convert Vercel AI SDK UIMessages → Snowflake Cortex message format.
      // When using threads only the latest user message needs to be included —
      // Snowflake stores the full history on its side.
      const sfMessages: SnowflakeCortexMessage[] = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: (m.parts as any[])
            .filter((p) => p.type === "text")
            .map((p) => ({ type: "text" as const, text: p.text as string })),
        }))
        .filter((m) => m.content.length > 0);

      const sfMetadata: ChatMetadata = {
        agentId: agent!.id,
        toolChoice: "none",
        toolCount: 0,
        chatModel,
      };

      // Captures metadata emitted at end of Snowflake stream (usage + model).
      // Set inside execute, read inside onFinish — both share this closure.
      const sfCapture = {
        usage: null as {
          model: string;
          input: number;
          output: number;
        } | null,
        // The new assistant message_id returned by Snowflake for this turn.
        // Persisted after the stream ends so the next turn knows its
        // parent_message_id.
        newAssistantMessageId: null as number | null,
      };

      logger.info(`Snowflake Intelligence agent: ${agent!.name}`);

      const sfStream = createUIMessageStream({
        execute: async ({ writer: dataStream }) => {
          const textId = generateUUID();
          const reasoningId = generateUUID();
          let textOpen = false;
          let reasoningOpen = false;

          for await (const event of callSnowflakeCortexStream({
            config: sfConfig,
            messages: sfMessages,
            threadId: sfThreadId,
            parentMessageId: sfParentMessageId,
          })) {
            switch (event.type) {
              case "reasoning-delta":
                // Once text has started, discard reasoning deltas — they are
                // post-answer status events from Snowflake and must not open
                // a second reasoning block after the answer.
                if (textOpen) break;
                if (!reasoningOpen) {
                  dataStream.write({
                    type: "reasoning-start",
                    id: reasoningId,
                  });
                  reasoningOpen = true;
                }
                dataStream.write({
                  type: "reasoning-delta",
                  delta: event.delta,
                  id: reasoningId,
                });
                break;

              case "text-delta":
                // Close reasoning part before opening text
                if (reasoningOpen) {
                  dataStream.write({ type: "reasoning-end", id: reasoningId });
                  reasoningOpen = false;
                }
                if (!textOpen) {
                  dataStream.write({ type: "text-start", id: textId });
                  textOpen = true;
                }
                dataStream.write({
                  type: "text-delta",
                  delta: event.delta,
                  id: textId,
                });
                break;

              case "table":
                // Tables go into the text part as markdown
                if (!textOpen) {
                  dataStream.write({ type: "text-start", id: textId });
                  textOpen = true;
                }
                dataStream.write({
                  type: "text-delta",
                  delta: event.markdown,
                  id: textId,
                });
                break;

              case "chart":
                // Vega-Lite chart specs are injected as a fenced vegalite code
                // block so the markdown renderer can render them inline
                if (!textOpen) {
                  dataStream.write({ type: "text-start", id: textId });
                  textOpen = true;
                }
                dataStream.write({
                  type: "text-delta",
                  delta: `\n\`\`\`vegalite\n${event.spec}\n\`\`\`\n`,
                  id: textId,
                });
                break;

              case "metadata":
                sfCapture.usage = {
                  model: event.model,
                  input: event.inputTokens,
                  output: event.outputTokens,
                };
                // Write metadata to the stream immediately so the UI tooltip
                // shows token usage without waiting for a page refresh.
                dataStream.write({
                  type: "message-metadata",
                  messageMetadata: {
                    ...sfMetadata,
                    usage: {
                      ...attachUsageCost({
                        inputTokens: event.inputTokens,
                        outputTokens: event.outputTokens,
                        totalTokens: event.inputTokens + event.outputTokens,
                        inputTokenDetails: {
                          noCacheTokens: undefined,
                          cacheReadTokens: undefined,
                          cacheWriteTokens: undefined,
                        },
                        outputTokenDetails: {
                          textTokens: undefined,
                          reasoningTokens: undefined,
                        },
                      }),
                    },
                    // Always show Snowflake as provider with the actual
                    // model name returned by the Cortex API
                    chatModel: {
                      provider: "snowflake",
                      model: event.model || "Snowflake Cortex",
                    },
                  } satisfies ChatMetadata,
                });
                break;

              case "thread-message-ids":
                // Stash the new assistant message_id so we can advance
                // parent_message_id for the next turn in onFinish.
                sfCapture.newAssistantMessageId = event.assistantMessageId;
                break;
            }
          }

          // Close any still-open parts
          if (reasoningOpen)
            dataStream.write({ type: "reasoning-end", id: reasoningId });
          if (textOpen) {
            dataStream.write({ type: "text-end", id: textId });
          } else {
            // Safety: ensure at least an empty text part so the message renders
            dataStream.write({ type: "text-start", id: textId });
            dataStream.write({ type: "text-end", id: textId });
          }
        },
        generateId: generateUUID,
        onFinish: async ({ responseMessage, isAborted }) => {
          const finalResponseMessage = isAborted
            ? appendAbortedResponseNotice(responseMessage)
            : responseMessage;

          // Populate metadata from the captured Snowflake usage/model info
          if (sfCapture.usage) {
            sfMetadata.usage = attachUsageCost({
              inputTokens: sfCapture.usage.input,
              outputTokens: sfCapture.usage.output,
              totalTokens: sfCapture.usage.input + sfCapture.usage.output,
              inputTokenDetails: {
                noCacheTokens: undefined,
                cacheReadTokens: undefined,
                cacheWriteTokens: undefined,
              },
              outputTokenDetails: {
                textTokens: undefined,
                reasoningTokens: undefined,
              },
            });
            sfMetadata.chatModel = {
              provider: "snowflake",
              model: sfCapture.usage.model || "Snowflake Cortex",
            };
          }

          // Advance parent_message_id so the next turn continues the thread
          // from this assistant reply.  If Snowflake didn't emit message IDs
          // (rare failure case per the docs) we leave the existing value.
          if (sfCapture.newAssistantMessageId !== null) {
            await chatRepository.updateThread(thread!.id, {
              snowflakeParentMessageId: sfCapture.newAssistantMessageId,
            });
            logger.info(
              `Advanced Snowflake thread ${sfThreadId} parent_message_id → ${sfCapture.newAssistantMessageId}`,
            );
          }

          if (finalResponseMessage.id === message.id) {
            await chatRepository.upsertMessage({
              threadId: thread!.id,
              ...finalResponseMessage,
              parts: finalResponseMessage.parts.map(convertToSavePart),
              metadata: sfMetadata,
            });
          } else {
            await chatRepository.upsertMessage({
              threadId: thread!.id,
              role: message.role,
              parts: message.parts.map(convertToSavePart),
              id: message.id,
            });
            await chatRepository.upsertMessage({
              threadId: thread!.id,
              role: finalResponseMessage.role,
              id: finalResponseMessage.id,
              parts: finalResponseMessage.parts.map(convertToSavePart),
              metadata: sfMetadata,
            });
          }
        },
        onError: handleError,
        originalMessages: messages,
      });

      return createUIMessageStreamResponse({
        stream: sfStream,
        consumeSseStream: consumeStream,
      });
    }
    // ── end Snowflake intercept ────────────────────────────────────────────

    if ((agent as any)?.agentType === "a2a_remote") {
      const a2aConfig = await a2aAgentRepository.selectA2AConfigByAgentId(
        agent!.id,
      );

      if (!a2aConfig) {
        return Response.json(
          { message: "A2A configuration not found for this agent" },
          { status: 404 },
        );
      }

      const userText = message.parts
        .filter((part: any) => part.type === "text")
        .map((part: any) => part.text as string)
        .join(" ")
        .trim();

      if (!userText) {
        return Response.json(
          {
            message:
              "A2A remote agents currently support text-only messages in this UI.",
          },
          { status: 400 },
        );
      }

      const currentA2AState =
        thread?.a2aAgentId === agent!.id
          ? {
              contextId: thread?.a2aContextId ?? undefined,
              taskId: thread?.a2aTaskId ?? undefined,
            }
          : {
              contextId: undefined,
              taskId: undefined,
            };

      const a2aMetadata: ChatMetadata = {
        agentId: agent!.id,
        toolChoice: "none",
        toolCount: 0,
        chatModel: {
          provider: "a2a",
          model: a2aConfig.agentCard.name || agent!.name,
        },
      };

      const a2aCapture = {
        contextId: currentA2AState.contextId ?? null,
        taskId: currentA2AState.taskId ?? null,
      };

      const a2aStream = createUIMessageStream({
        execute: async ({ writer: dataStream }) => {
          const textId = generateUUID();
          let textOpen = false;

          for await (const event of streamA2AAgentResponse({
            config: a2aConfig,
            text: userText,
            contextId: currentA2AState.contextId,
            taskId: currentA2AState.taskId,
          })) {
            if (event.contextId) {
              a2aCapture.contextId = event.contextId;
            }
            if (event.taskId) {
              a2aCapture.taskId = event.taskId;
            }

            if (!event.text) continue;

            if (!textOpen) {
              dataStream.write({ type: "text-start", id: textId });
              textOpen = true;
            }

            dataStream.write({
              type: "text-delta",
              delta: event.text,
              id: textId,
            });
          }

          if (textOpen) {
            dataStream.write({ type: "text-end", id: textId });
          } else {
            dataStream.write({ type: "text-start", id: textId });
            dataStream.write({ type: "text-end", id: textId });
          }

          dataStream.write({
            type: "message-metadata",
            messageMetadata: a2aMetadata,
          });
        },
        generateId: generateUUID,
        onFinish: async ({ responseMessage, isAborted }) => {
          const finalResponseMessage = isAborted
            ? appendAbortedResponseNotice(responseMessage)
            : responseMessage;

          if (!isAborted) {
            await chatRepository.updateThread(thread!.id, {
              a2aAgentId: agent!.id,
              a2aContextId: a2aCapture.contextId ?? null,
              a2aTaskId: a2aCapture.taskId ?? null,
            });
          }

          if (finalResponseMessage.id === message.id) {
            await chatRepository.upsertMessage({
              threadId: thread!.id,
              ...finalResponseMessage,
              parts: finalResponseMessage.parts.map(convertToSavePart),
              metadata: a2aMetadata,
            });
          } else {
            await chatRepository.upsertMessage({
              threadId: thread!.id,
              role: message.role,
              parts: message.parts.map(convertToSavePart),
              id: message.id,
            });
            await chatRepository.upsertMessage({
              threadId: thread!.id,
              role: finalResponseMessage.role,
              id: finalResponseMessage.id,
              parts: finalResponseMessage.parts.map(convertToSavePart),
              metadata: a2aMetadata,
            });
          }
        },
        onError: handleError,
        originalMessages: messages,
      });

      return createUIMessageStreamResponse({
        stream: a2aStream,
        consumeSseStream: consumeStream,
      });
    }

    if (agent?.instructions?.mentions) {
      mentions.push(...agent.instructions.mentions);
    }

    // ── Knowledge mention RAG context ────────────────────────────────────────
    const knowledgeMentionIds = Array.from(
      new Set(
        mentions
          .filter((m) => m.type === "knowledge")
          .map(
            (m) =>
              (m as Extract<ChatMention, { type: "knowledge" }>).knowledgeId,
          ),
      ),
    );

    const userQueryText = message.parts
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text as string)
      .join(" ")
      .trim();

    const knowledgeMentionGroups = (
      await Promise.all(
        knowledgeMentionIds.map((groupId) =>
          knowledgeRepository
            .selectGroupById(groupId, session.user.id)
            .catch(() => null),
        ),
      )
    ).filter((group) => group !== null) as NonNullable<
      Awaited<ReturnType<typeof knowledgeRepository.selectGroupById>>
    >[];
    // ── end knowledge context ─────────────────────────────────────────────────

    const useImageTool = Boolean(imageTool?.provider && imageTool?.model);

    const isToolCallAllowed =
      supportToolCall &&
      (toolChoice != "none" || mentions.length > 0) &&
      !useImageTool;

    const metadata: ChatMetadata = {
      agentId: agent?.id,
      toolChoice: toolChoice,
      toolCount: 0,
      chatModel: chatModel,
    };

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        const toolset = await loadWaveAgentBoundTools({
          agent,
          userId: session.user.id,
          mentions,
          allowedMcpServers,
          allowedAppDefaultToolkit,
          dataStream,
          abortSignal: request.signal,
          chatModel: chatModel!,
          source: "agent",
          isToolCallAllowed,
        });

        const inProgressToolParts = extractInProgressToolPart(message);
        if (inProgressToolParts.length) {
          await Promise.all(
            inProgressToolParts.map(async (part) => {
              const output = await manualToolExecuteByLastMessage(
                part,
                {
                  ...toolset.mcpTools,
                  ...toolset.workflowTools,
                  ...toolset.appDefaultTools,
                },
                request.signal,
              );
              part.output = output;

              dataStream.write({
                type: "tool-output-available",
                toolCallId: part.toolCallId,
                output,
              });
            }),
          );
        }

        const userPreferences = thread?.userPreferences || undefined;

        const mcpServerCustomizations = await safe()
          .map(() => {
            if (Object.keys(toolset.mcpTools ?? {}).length === 0)
              throw new Error("No tools found");
            return rememberMcpServerCustomizationsAction(session.user.id);
          })
          .map((v) => filterMcpServerCustomizations(toolset.mcpTools as any, v))
          .orElse({});
        const buildKnowledgeContextsForBudget = (() => {
          const cache = new Map<number, Promise<string[]>>();

          return async (totalBudget: number) => {
            if (
              !knowledgeMentionGroups.length ||
              !userQueryText ||
              totalBudget < 1
            ) {
              return [];
            }

            if (!cache.has(totalBudget)) {
              cache.set(
                totalBudget,
                (async () => {
                  const contexts: string[] = [];
                  let remainingKnowledgeBudget = totalBudget;

                  for (const [
                    index,
                    group,
                  ] of knowledgeMentionGroups.entries()) {
                    if (remainingKnowledgeBudget < 200) break;

                    const allocatedTokens = allocateSequentialKnowledgeTokens(
                      remainingKnowledgeBudget,
                      knowledgeMentionGroups.length - index,
                    );

                    const docs = await queryKnowledgeAsDocs(
                      group,
                      userQueryText,
                      {
                        userId: session.user.id,
                        source: "chat",
                        tokens: allocatedTokens,
                        resultMode: "section-first",
                      },
                    ).catch((err) => {
                      logger.warn(
                        `[Knowledge RAG] retrieval failed for group ${group.id}: ${err}`,
                      );
                      return null;
                    });

                    if (docs && docs.length > 0) {
                      const formatted = formatDocsAsText(
                        group.name,
                        docs,
                        userQueryText,
                      );
                      contexts.push(formatted);
                      remainingKnowledgeBudget = Math.max(
                        0,
                        remainingKnowledgeBudget -
                          estimateKnowledgePromptTokens(formatted),
                      );
                    }
                  }

                  return contexts;
                })(),
              );
            }

            return await cache.get(totalBudget)!;
          };
        })();
        const learnedPersonalizationPrompt =
          await getLearnedPersonalizationPromptForUser(session.user.id);

        const buildSystemPromptForKnowledgeBudget = async (
          knowledgeBudget: number,
        ) => {
          const knowledgeContexts =
            await buildKnowledgeContextsForBudget(knowledgeBudget);

          return {
            knowledgeContexts,
            systemPrompt: buildWaveAgentSystemPrompt({
              user: session.user,
              userPreferences,
              agent,
              subAgents: toolset.subAgents,
              attachedSkills: toolset.attachedSkills,
              knowledgeContexts,
              mcpServerCustomizations,
              toolCallUnsupported: !supportToolCall,
              extraPrompts: [learnedPersonalizationPrompt],
            }),
          };
        };

        const initialPromptContext = await buildSystemPromptForKnowledgeBudget(
          CHAT_KNOWLEDGE_CONTEXT_TOKENS,
        );
        const systemPrompt = initialPromptContext.systemPrompt;

        const IMAGE_TOOL: Record<string, Tool> = await (async (): Promise<
          Record<string, Tool>
        > => {
          if (!useImageTool) return {};
          try {
            const providerConfig = await settingsRepository.getProviderByName(
              imageTool!.provider!,
            );
            if (!providerConfig?.enabled) return {};
            const modelConfig = await settingsRepository.getModelForChat(
              imageTool!.provider!,
              imageTool!.model!,
            );
            if (!modelConfig) return {};
            return {
              [ImageToolName]: createDbImageTool(
                imageTool!.provider!,
                modelConfig.apiName,
                providerConfig.apiKey,
                providerConfig.baseUrl,
              ),
            };
          } catch {
            return {};
          }
        })();

        const buildVercelAITools = (options?: {
          includeAppDefaultTools?: boolean;
          excludedMcpToolKeys?: Set<string>;
        }) => {
          const filteredMcpTools = Object.fromEntries(
            Object.entries(toolset.mcpTools ?? {}).filter(
              ([toolName]) => !options?.excludedMcpToolKeys?.has(toolName),
            ),
          );

          return safe({
            ...filteredMcpTools,
            ...toolset.workflowTools,
            ...toolset.subagentTools,
            ...toolset.knowledgeTools,
            ...toolset.skillTools,
          })
            .map((t) => {
              const bindingTools =
                toolChoice === "manual" ||
                (message.metadata as ChatMetadata)?.toolChoice === "manual"
                  ? excludeToolExecution(t)
                  : t;

              return {
                ...bindingTools,
                ...(options?.includeAppDefaultTools === false
                  ? {}
                  : toolset.appDefaultTools),
                ...IMAGE_TOOL,
              };
            })
            .unwrap();
        };

        const vercelAITooles = buildVercelAITools();
        metadata.toolCount = Object.keys(vercelAITooles).length;

        const allowedMcpTools = Object.values(allowedMcpServers ?? {})
          .map((t) => t.tools)
          .flat();

        logger.info(
          `${agent ? `agent: ${agent.name}, ` : ""}tool mode: ${toolChoice}, mentions: ${mentions.length}`,
        );

        logger.info(
          `allowedMcpTools: ${allowedMcpTools.length ?? 0}, allowedAppDefaultToolkit: ${allowedAppDefaultToolkit?.length ?? 0}`,
        );
        if (useImageTool) {
          logger.info(
            `binding tool count Image: ${imageTool?.provider}/${imageTool?.model}`,
          );
        } else {
          logger.info(
            `binding tool count APP_DEFAULT: ${Object.keys(toolset.appDefaultTools ?? {}).length}, MCP: ${Object.keys(toolset.mcpTools ?? {}).length}, Workflow: ${Object.keys(toolset.workflowTools ?? {}).length}`,
          );
        }
        logger.info(`model: ${chatModel?.provider}/${chatModel?.model}`);
        const sendToolDefinitions = shouldSendToolDefinitionsToProvider({
          provider: chatModel?.provider,
          tools: vercelAITooles,
        });
        const strippedPersistedMessages =
          stripAttachmentPreviewPartsFromMessages(persistedMessages);
        const strippedCurrentMessage = stripAttachmentPreviewParts(message);
        const attachmentPreviewText = extractAttachmentPreviewText([
          ...persistedMessages,
          message,
        ]);
        const buildToolStages = (currentLoopMessages: ModelMessage[]) => {
          const hasExplicitMcpMentions = mentions.some(
            (mention) =>
              mention.type === "mcpTool" || mention.type === "mcpServer",
          );
          const usedToolNames =
            collectUsedToolNamesFromModelMessages(currentLoopMessages);
          const stages = [
            {
              reason: "full",
              tools: vercelAITooles,
              activeToolNames: Object.keys(vercelAITooles),
            },
          ];

          if (Object.keys(toolset.appDefaultTools ?? {}).length > 0) {
            const toolsWithoutAppDefault = buildVercelAITools({
              includeAppDefaultTools: false,
            });
            stages.push({
              reason: "without_app_default_tools",
              tools: toolsWithoutAppDefault,
              activeToolNames: Object.keys(toolsWithoutAppDefault),
            });
          }

          if (
            !hasExplicitMcpMentions &&
            Object.keys(toolset.mcpTools ?? {}).length
          ) {
            const excludedMcpToolKeys = new Set(
              Object.keys(toolset.mcpTools ?? {}).filter(
                (toolName) => !usedToolNames.has(toolName),
              ),
            );
            if (excludedMcpToolKeys.size > 0) {
              const toolsWithoutOptionalMcp = buildVercelAITools({
                includeAppDefaultTools: false,
                excludedMcpToolKeys,
              });
              stages.push({
                reason: "without_optional_mcp_tools",
                tools: toolsWithoutOptionalMcp,
                activeToolNames: Object.keys(toolsWithoutOptionalMcp),
              });
            }
          }

          return stages.filter(
            (stage, index, allStages) =>
              index ===
              allStages.findIndex(
                (other) =>
                  other.activeToolNames.join(",") ===
                  stage.activeToolNames.join(","),
              ),
          );
        };
        const seedMessages = await buildChatStreamSeedMessages(message);
        const seedMessageCount = seedMessages.length;
        const compactionRuntime: {
          checkpoint: ChatThreadCompactionCheckpoint | null;
          currentLoopMessages: ModelMessage[];
        } = {
          checkpoint: thread?.compactionCheckpoint ?? null,
          currentLoopMessages: [],
        };

        const result = streamText({
          model,
          system: systemPrompt,
          messages: seedMessages,
          experimental_transform: smoothStream({ chunking: "word" }),
          maxRetries: 2,
          stopWhen: stepCountIs(useImageTool ? 1 : 10),
          abortSignal: request.signal,
          experimental_context: compactionRuntime,
          prepareStep: async ({ messages: stepMessages, stepNumber }) => {
            if (stepNumber > 0) {
              compactionRuntime.currentLoopMessages =
                stepMessages.slice(seedMessageCount);
            }

            const contextLength = dbModelResult.contextLength;
            let activeKnowledgeBudget = CHAT_KNOWLEDGE_CONTEXT_TOKENS;
            let stripAttachmentPreviews = false;
            const toolStages = buildToolStages(
              compactionRuntime.currentLoopMessages,
            );
            let activeToolStage = toolStages[0] ?? {
              reason: "full",
              tools: vercelAITooles,
              activeToolNames: Object.keys(vercelAITooles),
            };

            const buildAssemblyForCurrentState = async () => {
              const promptContext = await buildSystemPromptForKnowledgeBudget(
                activeKnowledgeBudget,
              );
              const assembly = await buildCompactionAssembly({
                persistedMessages: stripAttachmentPreviews
                  ? strippedPersistedMessages
                  : persistedMessages,
                currentMessage: stripAttachmentPreviews
                  ? strippedCurrentMessage
                  : message,
                currentLoopMessages: compactionRuntime.currentLoopMessages,
                checkpoint: compactionRuntime.checkpoint,
                contextLength,
                systemPrompt: promptContext.systemPrompt,
                provider: chatModel?.provider,
                tools: activeToolStage.tools,
                dynamicTailEnabled: Boolean(
                  compactionRuntime.checkpoint?.summaryText,
                ),
                knowledgeContexts: promptContext.knowledgeContexts,
                attachmentPreviewText: stripAttachmentPreviews
                  ? ""
                  : attachmentPreviewText,
              });

              return {
                assembly,
              };
            };

            let { assembly } = await buildAssemblyForCurrentState();

            if (assembly.removedToolParts > 0) {
              logger.info(
                `provider compatibility pruned ${assembly.removedToolParts} stale tool parts across ${assembly.removedMessages} messages for ${chatModel?.provider}/${chatModel?.model}`,
              );
            }

            const beforeTokens = assembly.totalTokens;
            let afterTokens = beforeTokens;
            let checkpointUpdated = false;
            let generationFailureCode: string | undefined;
            let sheddingFailureCode: string | undefined;
            const shouldEvaluateCompaction =
              contextLength > 0 &&
              beforeTokens / contextLength >= CONTEXT_COMPACTION_TRIGGER_RATIO;
            const compactionStartedAt = new Date();

            if (shouldEvaluateCompaction) {
              await updateThreadCompactionState({
                threadId: thread!.id,
                source: "pre-send",
                status: "running",
                beforeTokens,
                afterTokens: null,
                failureCode: null,
                startedAt: compactionStartedAt,
                finishedAt: null,
              });
              dataStream.write({
                type: "data-compaction-status",
                data: {
                  active: true,
                  usedTokens: beforeTokens,
                  totalTokens: contextLength,
                  thresholdPercent: Math.round(
                    CONTEXT_COMPACTION_TRIGGER_RATIO * 100,
                  ),
                },
                transient: true,
              });

              try {
                if (assembly.compactableMessages.length > 0) {
                  let lastError: unknown = null;
                  for (let attempt = 0; attempt < 2; attempt += 1) {
                    try {
                      const checkpoint = await generateCompactionCheckpoint({
                        model,
                        chatModel,
                        checkpoint: compactionRuntime.checkpoint,
                        compactableMessages: assembly.compactableMessages,
                        summaryBudgetTokens: assembly.summaryBudgetTokens,
                        contextLength,
                        abortSignal: request.signal,
                      });

                      compactionRuntime.checkpoint =
                        await chatRepository.upsertCompactionCheckpoint({
                          threadId: thread!.id,
                          ...checkpoint,
                        });
                      checkpointUpdated = true;

                      ({ assembly } = await buildAssemblyForCurrentState());
                      afterTokens = assembly.totalTokens;

                      dataStream.write({
                        type: "data-compaction-checkpoint",
                        data: {
                          summaryText: compactionRuntime.checkpoint.summaryText,
                          compactedMessageCount:
                            compactionRuntime.checkpoint.compactedMessageCount,
                          summaryTokenCount:
                            compactionRuntime.checkpoint.summaryTokenCount,
                          usedTokensAfterCompaction: afterTokens,
                        },
                        transient: true,
                      });

                      lastError = null;
                      break;
                    } catch (error) {
                      lastError = error;
                    }
                  }

                  if (lastError) {
                    generationFailureCode = "generation_failed";
                    logger.warn(
                      `context compaction failed for thread ${thread!.id}: ${lastError}`,
                    );
                  }
                } else {
                  generationFailureCode = "no_compactable_history";
                }

                if (
                  contextLength > 0 &&
                  afterTokens / contextLength >= CONTEXT_COMPACTION_HARD_RATIO
                ) {
                  for (const knowledgeBudget of KNOWLEDGE_CONTEXT_BUDGET_STAGES) {
                    if (knowledgeBudget === activeKnowledgeBudget) continue;
                    activeKnowledgeBudget = knowledgeBudget;
                    ({ assembly } = await buildAssemblyForCurrentState());
                    afterTokens = assembly.totalTokens;
                    sheddingFailureCode = `knowledge_budget_${knowledgeBudget}`;
                    if (
                      afterTokens / contextLength <
                      CONTEXT_COMPACTION_HARD_RATIO
                    ) {
                      break;
                    }
                  }
                }

                if (
                  contextLength > 0 &&
                  afterTokens / contextLength >=
                    CONTEXT_COMPACTION_HARD_RATIO &&
                  attachmentPreviewText.trim()
                ) {
                  stripAttachmentPreviews = true;
                  ({ assembly } = await buildAssemblyForCurrentState());
                  afterTokens = assembly.totalTokens;
                  sheddingFailureCode = "attachment_preview_removed";
                }

                if (
                  contextLength > 0 &&
                  afterTokens / contextLength >= CONTEXT_COMPACTION_HARD_RATIO
                ) {
                  for (const toolStage of toolStages.slice(1)) {
                    activeToolStage = toolStage;
                    ({ assembly } = await buildAssemblyForCurrentState());
                    afterTokens = assembly.totalTokens;
                    sheddingFailureCode = toolStage.reason;
                    if (
                      afterTokens / contextLength <
                      CONTEXT_COMPACTION_HARD_RATIO
                    ) {
                      break;
                    }
                  }
                }
              } finally {
                dataStream.write({
                  type: "data-compaction-status",
                  data: { active: false },
                  transient: true,
                });
              }
            }

            if (
              contextLength > 0 &&
              afterTokens / contextLength >= CONTEXT_COMPACTION_HARD_RATIO
            ) {
              const hardFailureCode =
                generationFailureCode && sheddingFailureCode
                  ? `${generationFailureCode}:${sheddingFailureCode}`
                  : (generationFailureCode ??
                    sheddingFailureCode ??
                    `prompt_still_above_${Math.round(
                      CONTEXT_COMPACTION_HARD_RATIO * 100,
                    )}_percent`);
              await updateThreadCompactionState({
                threadId: thread!.id,
                source: "pre-send",
                status: "failed",
                beforeTokens,
                afterTokens,
                failureCode: hardFailureCode,
                startedAt: compactionStartedAt,
                finishedAt: new Date(),
              });
              metadata.compaction = {
                performed: checkpointUpdated,
                beforeTokens,
                afterTokens,
                compactedMessageCount:
                  compactionRuntime.checkpoint?.compactedMessageCount,
                checkpointUpdated,
                failureCode: hardFailureCode,
                breakdown: assembly.breakdown,
              };
              throw new Error(
                buildCompactionFailureMessage({
                  failureCode: hardFailureCode,
                  breakdown: assembly.breakdown,
                }),
              );
            }

            if (
              shouldEvaluateCompaction ||
              checkpointUpdated ||
              generationFailureCode ||
              sheddingFailureCode ||
              afterTokens / Math.max(contextLength, 1) >
                CONTEXT_COMPACTION_TARGET_RATIO
            ) {
              if (shouldEvaluateCompaction) {
                const finalFailureCode =
                  generationFailureCode && sheddingFailureCode
                    ? `${generationFailureCode}:${sheddingFailureCode}`
                    : (generationFailureCode ?? sheddingFailureCode ?? null);
                await updateThreadCompactionState({
                  threadId: thread!.id,
                  source: "pre-send",
                  status: finalFailureCode ? "failed" : "completed",
                  beforeTokens,
                  afterTokens,
                  failureCode: finalFailureCode,
                  startedAt: compactionStartedAt,
                  finishedAt: new Date(),
                });
              }
              metadata.compaction = {
                performed: checkpointUpdated,
                beforeTokens,
                afterTokens,
                compactedMessageCount:
                  compactionRuntime.checkpoint?.compactedMessageCount,
                checkpointUpdated,
                failureCode:
                  generationFailureCode && sheddingFailureCode
                    ? `${generationFailureCode}:${sheddingFailureCode}`
                    : (generationFailureCode ?? sheddingFailureCode),
                breakdown: assembly.breakdown,
              };
            }

            return {
              system: assembly.systemPrompt,
              messages: assembly.messages,
              experimental_context: compactionRuntime,
              ...(sendToolDefinitions
                ? {
                    activeTools: activeToolStage.activeToolNames,
                    toolChoice: activeToolStage.activeToolNames.length
                      ? ("auto" as const)
                      : ("none" as const),
                  }
                : {}),
            };
          },
          ...(sendToolDefinitions
            ? {
                tools: vercelAITooles,
                toolChoice: "auto" as const,
              }
            : {}),
          // Disable reasoning/thinking when generating images — it adds no
          // value for a simple tool call decision and pollutes the UI.
          ...(useImageTool && {
            providerOptions: {
              openrouter: {
                reasoning: { effort: "none" as const, exclude: true },
              },
              google: { thinkingConfig: { thinkingBudget: 0 } },
              openai: { reasoningEffort: "none" },
              anthropic: { thinking: { type: "disabled" } },
            },
          }),
        });
        result.consumeStream();
        dataStream.merge(
          result.toUIMessageStream({
            messageMetadata: ({ part }) => {
              if (part.type == "finish") {
                metadata.usage = attachUsageCost(part.totalUsage as ChatUsage);
                return metadata;
              }
            },
          }),
        );
      },

      generateId: generateUUID,
      onFinish: async ({ responseMessage, isAborted }) => {
        const finalResponseMessage = isAborted
          ? appendAbortedResponseNotice(responseMessage)
          : responseMessage;

        if (finalResponseMessage.id == message.id) {
          await chatRepository.upsertMessage({
            threadId: thread!.id,
            ...finalResponseMessage,
            parts: finalResponseMessage.parts.map(convertToSavePart),
            metadata,
          });
        } else {
          await chatRepository.upsertMessage({
            threadId: thread!.id,
            role: message.role,
            parts: message.parts.map(convertToSavePart),
            id: message.id,
          });
          await chatRepository.upsertMessage({
            threadId: thread!.id,
            role: finalResponseMessage.role,
            id: finalResponseMessage.id,
            parts: finalResponseMessage.parts.map(convertToSavePart),
            metadata,
          });
        }

        if (agent) {
          agentRepository.updateAgent(agent.id, session.user.id, {
            updatedAt: new Date(),
          } as any);
        }
      },
      onError: handleError,
      originalMessages: messages,
    });

    return createUIMessageStreamResponse({
      stream,
      consumeSseStream: consumeStream,
    });
  } catch (error: any) {
    logger.error(error);
    return Response.json({ message: error.message }, { status: 500 });
  }
}
