import { NextRequest, NextResponse } from "next/server";
import {
  authenticateExternalAgentRequest,
  convertOpenAiMessagesToModelMessages,
  createUnauthorizedResponse,
  getExternalAgentOpenAiModelId,
  hasExternalToolConversation,
  loadExternalAccessAgent,
  mapFinishReasonToOpenAi,
  normalizeOpenAiTextContent,
  openAiChatCompletionsRequestSchema,
  openAiMessageSchema,
  resolveExternalAgentModelSelection,
  summarizeExternalPreview,
  streamContinueManagedTools,
  streamEmmaManagedAgentRun,
} from "lib/ai/agent/external-access";
import { agentAnalyticsRepository } from "lib/db/repository";
import { z } from "zod";

interface Params {
  params: Promise<{ id: string }>;
}

function createInvalidRequestResponse(message: string, status = 400) {
  return NextResponse.json(
    {
      error: {
        message,
        type: "invalid_request_error",
      },
    },
    { status },
  );
}

function createOpenAiUsage(usage?: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}) {
  return {
    prompt_tokens: usage?.inputTokens ?? 0,
    completion_tokens: usage?.outputTokens ?? 0,
    total_tokens:
      usage?.totalTokens ??
      (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
  };
}

function createOpenAiToolCalls(
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>,
) {
  return toolCalls.map((toolCall) => ({
    id: toolCall.toolCallId,
    type: "function" as const,
    function: {
      name: toolCall.toolName,
      arguments: JSON.stringify(toolCall.input ?? {}),
    },
  }));
}

function createAssistantResponseMessage(
  text: string,
  toolCalls: ReturnType<typeof createOpenAiToolCalls>,
): z.infer<typeof openAiMessageSchema> {
  return {
    role: "assistant",
    content: text || null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
}

async function startAgentRun(options: {
  agentId: string;
  request: z.infer<typeof openAiChatCompletionsRequestSchema>;
  abortSignal: AbortSignal;
}) {
  const agent = await loadExternalAccessAgent(options.agentId);
  if (!agent || !agent.mcpEnabled || agent.agentType === "snowflake_cortex") {
    return {
      error: NextResponse.json(
        {
          error: {
            message:
              "Agent external access is not enabled for this base agent.",
            type: "forbidden",
          },
        },
        { status: 403 },
      ),
    } as const;
  }

  const isContinueManagedTools = hasExternalToolConversation(options.request);
  const run = isContinueManagedTools
    ? await streamContinueManagedTools({
        agent,
        request: options.request,
        abortSignal: options.abortSignal,
      })
    : await streamEmmaManagedAgentRun({
        agent,
        messages: convertOpenAiMessagesToModelMessages(
          options.request.messages,
        ),
        abortSignal: options.abortSignal,
        temperature: options.request.temperature,
        topP: options.request.top_p,
        maxOutputTokens: options.request.max_tokens,
        stopSequences: Array.isArray(options.request.stop)
          ? options.request.stop
          : options.request.stop
            ? [options.request.stop]
            : undefined,
      });

  return {
    agent,
    isContinueManagedTools,
    run,
  } as const;
}

function encodeSseData(data: string) {
  return new TextEncoder().encode(`data: ${data}\n\n`);
}

function createChatCompletionChunk(options: {
  id: string;
  model: string;
  delta: Record<string, unknown>;
  finishReason?: string | null;
}) {
  return {
    id: options.id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: options.model,
    choices: [
      {
        index: 0,
        delta: options.delta,
        finish_reason: options.finishReason ?? null,
      },
    ],
  };
}

function buildChatRequestPreview(
  messages: z.infer<typeof openAiChatCompletionsRequestSchema>["messages"],
) {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  return summarizeExternalPreview(
    normalizeOpenAiTextContent(latestUserMessage?.content),
  );
}

async function recordChatUsage(options: {
  agentId: string;
  userAgent: string | null;
  request: z.infer<typeof openAiChatCompletionsRequestSchema>;
  responseMessage?: z.infer<typeof openAiMessageSchema> | null;
  responsePreview?: string | null;
  finishReason?: string | null;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  status?: "success" | "error" | "cancelled";
  errorMessage?: string | null;
}) {
  try {
    const selectedModel = await resolveExternalAgentModelSelection({
      mcpModelProvider: null,
      mcpModelName: null,
      ...((await loadExternalAccessAgent(options.agentId)) ?? {}),
    });

    await agentAnalyticsRepository.recordContinueChatUsage({
      agentId: options.agentId,
      userAgent: options.userAgent,
      messages: options.request.messages,
      responseMessage: options.responseMessage,
      requestPreview: buildChatRequestPreview(options.request.messages),
      responsePreview: options.responsePreview || options.errorMessage || null,
      promptTokens: options.usage?.inputTokens,
      completionTokens: options.usage?.outputTokens,
      totalTokens: options.usage?.totalTokens,
      finishReason: options.finishReason ?? null,
      status: options.status ?? "success",
      modelProvider: selectedModel?.provider ?? null,
      modelName: selectedModel?.model ?? null,
    });
  } catch {
    // Dashboard logging must never break the client response path.
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id: agentId } = await params;

  const isAuthorized = await authenticateExternalAgentRequest(
    req.headers,
    agentId,
  );
  if (!isAuthorized) {
    return createUnauthorizedResponse();
  }

  let requestBody: z.infer<typeof openAiChatCompletionsRequestSchema>;
  try {
    requestBody = openAiChatCompletionsRequestSchema.parse(await req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createInvalidRequestResponse(
        error.issues[0]?.message || "Invalid request",
      );
    }
    return createInvalidRequestResponse("Invalid request body");
  }

  const started = await startAgentRun({
    agentId,
    request: requestBody,
    abortSignal: req.signal,
  });
  if ("error" in started) {
    return started.error;
  }

  const modelId = getExternalAgentOpenAiModelId(started.agent.name);
  const completionId = `chatcmpl_${crypto.randomUUID()}`;

  if (!requestBody.stream) {
    try {
      const [text, toolCalls, finishReason, totalUsage] = await Promise.all([
        started.run.text,
        started.run.toolCalls,
        started.run.finishReason,
        started.run.totalUsage,
      ]);

      const openAiToolCalls = createOpenAiToolCalls(
        toolCalls.map((toolCall: any) => ({
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          input: toolCall.input,
        })),
      );

      await recordChatUsage({
        agentId,
        userAgent: req.headers.get("user-agent"),
        request: requestBody,
        responseMessage: createAssistantResponseMessage(
          text || "",
          openAiToolCalls,
        ),
        responsePreview:
          summarizeExternalPreview(text || "") ||
          summarizeExternalPreview(
            openAiToolCalls
              .map((toolCall) => toolCall.function.name)
              .join(", "),
          ),
        finishReason,
        usage: totalUsage,
      });

      return NextResponse.json({
        id: completionId,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: text || null,
              ...(openAiToolCalls.length > 0
                ? { tool_calls: openAiToolCalls }
                : {}),
            },
            finish_reason: mapFinishReasonToOpenAi(finishReason),
          },
        ],
        usage: createOpenAiUsage(totalUsage),
      });
    } catch (error: any) {
      await recordChatUsage({
        agentId,
        userAgent: req.headers.get("user-agent"),
        request: requestBody,
        status: req.signal.aborted ? "cancelled" : "error",
        errorMessage: error?.message || "Failed to complete chat request",
      });

      return NextResponse.json(
        {
          error: {
            message: error?.message || "Failed to complete chat request",
            type: "server_error",
          },
        },
        { status: 500 },
      );
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const toolIndexes = new Map<string, number>();
      const streamedToolCalls = new Map<
        string,
        {
          id: string;
          type: "function";
          function: {
            name: string;
            arguments: string;
          };
        }
      >();
      let nextToolIndex = 0;
      let finishSent = false;
      let responseText = "";
      let responsePreviewText = "";

      const send = (payload: unknown) => {
        controller.enqueue(encodeSseData(JSON.stringify(payload)));
      };

      try {
        send(
          createChatCompletionChunk({
            id: completionId,
            model: modelId,
            delta: { role: "assistant" },
          }),
        );

        for await (const part of started.run.fullStream) {
          if (part.type === "text-delta") {
            responseText += part.text;
            responsePreviewText = summarizeExternalPreview(
              `${responsePreviewText}${part.text}`,
              280,
            );
            send(
              createChatCompletionChunk({
                id: completionId,
                model: modelId,
                delta: { content: part.text },
              }),
            );
            continue;
          }

          if (part.type === "tool-call") {
            const existingIndex = toolIndexes.get(part.toolCallId);
            const index =
              existingIndex ??
              (() => {
                const value = nextToolIndex;
                toolIndexes.set(part.toolCallId, value);
                nextToolIndex += 1;
                return value;
              })();

            streamedToolCalls.set(part.toolCallId, {
              id: part.toolCallId,
              type: "function",
              function: {
                name: part.toolName,
                arguments: JSON.stringify(part.input ?? {}),
              },
            });

            send(
              createChatCompletionChunk({
                id: completionId,
                model: modelId,
                delta: {
                  tool_calls: [
                    {
                      index,
                      id: part.toolCallId,
                      type: "function",
                      function: {
                        name: part.toolName,
                        arguments: JSON.stringify(part.input ?? {}),
                      },
                    },
                  ],
                },
              }),
            );
            responsePreviewText = summarizeExternalPreview(
              `${responsePreviewText} [tool:${part.toolName}]`,
              280,
            );
            continue;
          }

          if (part.type === "finish") {
            finishSent = true;
            send(
              createChatCompletionChunk({
                id: completionId,
                model: modelId,
                delta: {},
                finishReason: mapFinishReasonToOpenAi(part.finishReason),
              }),
            );
          }
        }

        if (!finishSent) {
          const finishReason = await started.run.finishReason;
          send(
            createChatCompletionChunk({
              id: completionId,
              model: modelId,
              delta: {},
              finishReason: mapFinishReasonToOpenAi(finishReason),
            }),
          );
        }

        const [finishReason, totalUsage] = await Promise.all([
          started.run.finishReason,
          started.run.totalUsage,
        ]);

        await recordChatUsage({
          agentId,
          userAgent: req.headers.get("user-agent"),
          request: requestBody,
          responseMessage: createAssistantResponseMessage(
            responseText,
            Array.from(streamedToolCalls.values()),
          ),
          responsePreview: responsePreviewText,
          finishReason,
          usage: totalUsage,
        });

        controller.enqueue(encodeSseData("[DONE]"));
        controller.close();
      } catch (error: any) {
        await recordChatUsage({
          agentId,
          userAgent: req.headers.get("user-agent"),
          request: requestBody,
          responsePreview: responsePreviewText,
          status: req.signal.aborted ? "cancelled" : "error",
          errorMessage: error?.message || "Failed to stream chat completion",
        });
        controller.error(
          new Error(error?.message || "Failed to stream chat completion"),
        );
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
