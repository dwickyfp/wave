import {
  Tool,
  UIMessage,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  smoothStream,
  stepCountIs,
  streamText,
} from "ai";

import { getDbModel } from "lib/ai/provider-factory";

import {
  ChatMention,
  ChatMetadata,
  chatApiSchemaRequestBodySchema,
} from "app-types/chat";
import {
  buildKnowledgeContextSystemPrompt,
  buildMcpServerCustomizationsSystemPrompt,
  buildParallelSubAgentSystemPrompt,
  buildToolCallUnsupportedModelSystemPrompt,
  buildUserSystemPrompt,
} from "lib/ai/prompts";
import {
  agentRepository,
  chatRepository,
  knowledgeRepository,
  settingsRepository,
  snowflakeAgentRepository,
  subAgentRepository,
} from "lib/db/repository";
import globalLogger from "logger";

import { errorIf, safe } from "ts-safe";

import { buildCsvIngestionPreviewParts } from "@/lib/ai/ingest/csv-ingest";
import { getSession } from "auth/server";
import { colorize } from "consola/utils";
import { loadSubAgentTools } from "lib/ai/agent/subagent-loader";
import { ImageToolName } from "lib/ai/tools";
import { createDbImageTool } from "lib/ai/tools/image";
import {
  createKnowledgeDocsTool,
  knowledgeDocsToolName,
} from "lib/ai/tools/knowledge-tool";
import {
  queryKnowledgeAsDocs,
  formatDocsAsText,
} from "lib/knowledge/retriever";
import { serverFileStorage } from "lib/file-storage";
import {
  type SnowflakeCortexMessage,
  callSnowflakeCortexStream,
  createSnowflakeThread,
} from "lib/snowflake/client";
import { generateUUID } from "lib/utils";
import {
  rememberAgentAction,
  rememberMcpServerCustomizationsAction,
} from "./actions";
import {
  convertToSavePart,
  excludeToolExecution,
  extractInProgressToolPart,
  filterMcpServerCustomizations,
  handleError,
  loadAppDefaultTools,
  loadMcpTools,
  loadWorkFlowTools,
  manualToolExecuteByLastMessage,
  mergeSystemPrompt,
} from "./shared.chat";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `Chat API: `),
});

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

    let thread = await chatRepository.selectThreadDetails(id);

    if (!thread) {
      logger.info(`create chat thread: ${id}`);
      const newThread = await chatRepository.insertThread({
        id,
        title: "",
        userId: session.user.id,
      });
      thread = await chatRepository.selectThreadDetails(newThread.id);
    }

    if (thread!.userId !== session.user.id) {
      return new Response("Forbidden", { status: 403 });
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
    const ingestionPreviewParts = await buildCsvIngestionPreviewParts(
      attachments,
      (key) => serverFileStorage.download(key),
    );
    if (ingestionPreviewParts.length) {
      const baseParts = [...message.parts];
      let insertionIndex = -1;
      for (let i = baseParts.length - 1; i >= 0; i -= 1) {
        if (baseParts[i]?.type === "text") {
          insertionIndex = i;
          break;
        }
      }
      if (insertionIndex !== -1) {
        baseParts.splice(insertionIndex, 0, ...ingestionPreviewParts);
        message.parts = baseParts;
      } else {
        message.parts = [...baseParts, ...ingestionPreviewParts];
      }
    }

    if (attachments.length) {
      const firstTextIndex = message.parts.findIndex(
        (part: any) => part?.type === "text",
      );
      const attachmentParts: any[] = [];

      attachments.forEach((attachment) => {
        const exists = message.parts.some(
          (part: any) =>
            part?.type === attachment.type && part?.url === attachment.url,
        );
        if (exists) return;

        if (attachment.type === "file") {
          attachmentParts.push({
            type: "file",
            url: attachment.url,
            mediaType: attachment.mediaType,
            filename: attachment.filename,
          });
        } else if (attachment.type === "source-url") {
          attachmentParts.push({
            type: "source-url",
            url: attachment.url,
            mediaType: attachment.mediaType,
            title: attachment.filename,
          });
        }
      });

      if (attachmentParts.length) {
        if (firstTextIndex >= 0) {
          message.parts = [
            ...message.parts.slice(0, firstTextIndex),
            ...attachmentParts,
            ...message.parts.slice(firstTextIndex),
          ];
        } else {
          message.parts = [...message.parts, ...attachmentParts];
        }
      }
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
        onFinish: async ({ responseMessage }) => {
          // Populate metadata from the captured Snowflake usage/model info
          if (sfCapture.usage) {
            sfMetadata.usage = {
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
            };
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

          if (responseMessage.id === message.id) {
            await chatRepository.upsertMessage({
              threadId: thread!.id,
              ...responseMessage,
              parts: responseMessage.parts.map(convertToSavePart),
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
              role: responseMessage.role,
              id: responseMessage.id,
              parts: responseMessage.parts.map(convertToSavePart),
              metadata: sfMetadata,
            });
          }
        },
        onError: handleError,
        originalMessages: messages,
      });

      return createUIMessageStreamResponse({ stream: sfStream });
    }
    // ── end Snowflake intercept ────────────────────────────────────────────

    if (agent?.instructions?.mentions) {
      mentions.push(...agent.instructions.mentions);
    }

    // ── Knowledge mention RAG context ────────────────────────────────────────
    const knowledgeMentionIds = mentions
      .filter((m) => m.type === "knowledge")
      .map(
        (m) => (m as Extract<ChatMention, { type: "knowledge" }>).knowledgeId,
      );

    const userQueryText = message.parts
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text as string)
      .join(" ")
      .trim();

    const knowledgeContexts: string[] = [];
    if (knowledgeMentionIds.length && userQueryText) {
      for (const groupId of knowledgeMentionIds) {
        const group = await knowledgeRepository
          .selectGroupById(groupId, session.user.id)
          .catch(() => null);
        if (!group) continue;
        const docs = await queryKnowledgeAsDocs(group, userQueryText, {
          userId: session.user.id,
          source: "chat",
        }).catch((err) => {
          logger.warn(
            `[Knowledge RAG] retrieval failed for group ${groupId}: ${err}`,
          );
          return null;
        });
        if (docs) {
          knowledgeContexts.push(
            formatDocsAsText(group.name, docs, userQueryText),
          );
        }
      }
    }
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
        const MCP_TOOLS = await safe()
          .map(errorIf(() => !isToolCallAllowed && "Not allowed"))
          .map(() =>
            loadMcpTools({
              mentions,
              allowedMcpServers,
            }),
          )
          .orElse({});

        const WORKFLOW_TOOLS = await safe()
          .map(errorIf(() => !isToolCallAllowed && "Not allowed"))
          .map(() =>
            loadWorkFlowTools({
              mentions,
              dataStream,
            }),
          )
          .orElse({});

        const APP_DEFAULT_TOOLS = await safe()
          .map(errorIf(() => !isToolCallAllowed && "Not allowed"))
          .map(() =>
            loadAppDefaultTools({
              mentions,
              allowedAppDefaultToolkit,
            }),
          )
          .orElse({});

        const agentWithSubAgents =
          agent?.subAgentsEnabled && agent.id
            ? {
                ...agent,
                subAgents: await subAgentRepository.selectSubAgentsByAgentId(
                  agent.id,
                ),
              }
            : agent;

        const SUBAGENT_TOOLS = await safe()
          .map(errorIf(() => !isToolCallAllowed && "Not allowed"))
          .map(
            errorIf(
              () =>
                !agentWithSubAgents?.subAgentsEnabled &&
                "Subagents not enabled",
            ),
          )
          .map(() =>
            loadSubAgentTools(
              agentWithSubAgents!,
              dataStream,
              request.signal,
              chatModel!,
            ),
          )
          .orElse({});

        // Knowledge tools for agents with attached knowledge groups
        const KNOWLEDGE_TOOLS: Record<string, Tool> = await safe()
          .map(errorIf(() => !isToolCallAllowed && "Not allowed"))
          .map(errorIf(() => !agent?.id && "No agent"))
          .map(async () => {
            const groups = await knowledgeRepository.getGroupsByAgentId(
              agent!.id,
            );
            const tools: Record<string, Tool> = {};
            for (const group of groups) {
              tools[knowledgeDocsToolName(group.id)] = createKnowledgeDocsTool(
                group,
                {
                  userId: session.user.id,
                  source: "agent",
                },
              );
            }
            return tools;
          })
          .orElse({});

        const inProgressToolParts = extractInProgressToolPart(message);
        if (inProgressToolParts.length) {
          await Promise.all(
            inProgressToolParts.map(async (part) => {
              const output = await manualToolExecuteByLastMessage(
                part,
                { ...MCP_TOOLS, ...WORKFLOW_TOOLS, ...APP_DEFAULT_TOOLS },
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
            if (Object.keys(MCP_TOOLS ?? {}).length === 0)
              throw new Error("No tools found");
            return rememberMcpServerCustomizationsAction(session.user.id);
          })
          .map((v) => filterMcpServerCustomizations(MCP_TOOLS!, v))
          .orElse({});

        const systemPrompt = mergeSystemPrompt(
          buildUserSystemPrompt(session.user, userPreferences, agent),
          buildMcpServerCustomizationsSystemPrompt(mcpServerCustomizations),
          buildParallelSubAgentSystemPrompt(
            agentWithSubAgents?.subAgents ?? [],
          ),
          !supportToolCall && buildToolCallUnsupportedModelSystemPrompt,
          buildKnowledgeContextSystemPrompt(knowledgeContexts),
        );

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
        const vercelAITooles = safe({
          ...MCP_TOOLS,
          ...WORKFLOW_TOOLS,
          ...SUBAGENT_TOOLS,
          ...KNOWLEDGE_TOOLS,
        })
          .map((t) => {
            const bindingTools =
              toolChoice === "manual" ||
              (message.metadata as ChatMetadata)?.toolChoice === "manual"
                ? excludeToolExecution(t)
                : t;
            return {
              ...bindingTools,
              ...APP_DEFAULT_TOOLS, // APP_DEFAULT_TOOLS Not Supported Manual
              ...IMAGE_TOOL,
            };
          })
          .unwrap();
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
            `binding tool count APP_DEFAULT: ${Object.keys(APP_DEFAULT_TOOLS ?? {}).length}, MCP: ${Object.keys(MCP_TOOLS ?? {}).length}, Workflow: ${Object.keys(WORKFLOW_TOOLS ?? {}).length}`,
          );
        }
        logger.info(`model: ${chatModel?.provider}/${chatModel?.model}`);

        // Strip base64 image data from image tool results in the conversation
        // history. The client stores the full base64 for display purposes, but
        // sending it back to the LLM on every subsequent request would exceed
        // the token limit (1MB image ≈ 1M tokens).
        const modelMessages = (await convertToModelMessages(messages)).map(
          (msg) => {
            if (msg.role !== "tool") return msg;
            return {
              ...msg,
              content: msg.content.map((part) => {
                if (part.type !== "tool-result") return part;
                if (part.toolName !== ImageToolName) return part;
                const output = part.output;
                if (output.type !== "json") return part;
                const val = output.value as Record<string, unknown>;
                return {
                  ...part,
                  output: {
                    type: "text" as const,
                    value: (val?.guide as string) ?? "Image generated.",
                  },
                };
              }),
            };
          },
        );

        const result = streamText({
          model,
          system: systemPrompt,
          messages: modelMessages,
          experimental_transform: smoothStream({ chunking: "word" }),
          maxRetries: 2,
          tools: vercelAITooles,
          stopWhen: stepCountIs(useImageTool ? 1 : 10),
          toolChoice: "auto",
          abortSignal: request.signal,
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
                metadata.usage = part.totalUsage;
                return metadata;
              }
            },
          }),
        );
      },

      generateId: generateUUID,
      onFinish: async ({ responseMessage }) => {
        if (responseMessage.id == message.id) {
          await chatRepository.upsertMessage({
            threadId: thread!.id,
            ...responseMessage,
            parts: responseMessage.parts.map(convertToSavePart),
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
            role: responseMessage.role,
            id: responseMessage.id,
            parts: responseMessage.parts.map(convertToSavePart),
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
    });
  } catch (error: any) {
    logger.error(error);
    return Response.json({ message: error.message }, { status: 500 });
  }
}
