import { NextRequest, NextResponse } from "next/server";
import {
  authenticateExternalAgentRequest,
  createUnauthorizedResponse,
  getExternalAgentAutocompleteOpenAiModelId,
  loadExternalAccessAgent,
  mapFinishReasonToOpenAi,
  normalizeLegacyCompletionPrompt,
  openAiLegacyCompletionsRequestSchema,
  resolveExternalAgentAutocompleteModelSelection,
  streamContinueAutocomplete,
  summarizeExternalPreview,
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

function encodeSseData(data: string) {
  return new TextEncoder().encode(`data: ${data}\n\n`);
}

function createCompletionChunk(options: {
  id: string;
  model: string;
  text: string;
  finishReason?: string | null;
}) {
  return {
    id: options.id,
    object: "text_completion",
    created: Math.floor(Date.now() / 1000),
    model: options.model,
    choices: [
      {
        text: options.text,
        index: 0,
        logprobs: null,
        finish_reason: options.finishReason ?? null,
      },
    ],
  };
}

async function recordAutocompleteUsage(options: {
  agentId: string;
  userAgent: string | null;
  request: z.infer<typeof openAiLegacyCompletionsRequestSchema>;
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
    const selectedModel = await resolveExternalAgentAutocompleteModelSelection({
      ...((await loadExternalAccessAgent(options.agentId)) ?? {}),
    });

    await agentAnalyticsRepository.recordContinueAutocompleteUsage({
      agentId: options.agentId,
      userAgent: options.userAgent,
      requestPreview: summarizeExternalPreview(
        normalizeLegacyCompletionPrompt(options.request.prompt),
      ),
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
    // Do not fail the completion response because analytics logging failed.
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

  let requestBody: z.infer<typeof openAiLegacyCompletionsRequestSchema>;
  try {
    requestBody = openAiLegacyCompletionsRequestSchema.parse(await req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createInvalidRequestResponse(
        error.issues[0]?.message || "Invalid request",
      );
    }
    return createInvalidRequestResponse("Invalid request body");
  }

  const agent = await loadExternalAccessAgent(agentId);
  if (!agent || !agent.mcpEnabled || agent.agentType === "snowflake_cortex") {
    return NextResponse.json(
      {
        error: {
          message: "Agent external access is not enabled for this base agent.",
          type: "forbidden",
        },
      },
      { status: 403 },
    );
  }

  if (!agent.mcpAutocompleteModelProvider || !agent.mcpAutocompleteModelName) {
    return NextResponse.json(
      {
        error: {
          message:
            "No autocomplete model is configured for this agent. Select one in Agent Access before using Continue autocomplete.",
          type: "invalid_request_error",
        },
      },
      { status: 400 },
    );
  }

  let run;
  try {
    run = await streamContinueAutocomplete({
      agent,
      request: requestBody,
      abortSignal: req.signal,
    });
  } catch (error: any) {
    await recordAutocompleteUsage({
      agentId,
      userAgent: req.headers.get("user-agent"),
      request: requestBody,
      status: req.signal.aborted ? "cancelled" : "error",
      errorMessage: error?.message || "Failed to start autocomplete request",
    });

    return NextResponse.json(
      {
        error: {
          message: error?.message || "Failed to start autocomplete request",
          type: "server_error",
        },
      },
      { status: 500 },
    );
  }

  const modelId = getExternalAgentAutocompleteOpenAiModelId(agent.name);
  const completionId = `cmpl_${crypto.randomUUID()}`;

  if (!requestBody.stream) {
    try {
      const [text, finishReason, totalUsage] = await Promise.all([
        run.text,
        run.finishReason,
        run.totalUsage,
      ]);

      await recordAutocompleteUsage({
        agentId,
        userAgent: req.headers.get("user-agent"),
        request: requestBody,
        responsePreview: summarizeExternalPreview(text || ""),
        finishReason,
        usage: totalUsage,
      });

      return NextResponse.json({
        id: completionId,
        object: "text_completion",
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [
          {
            text: text || "",
            index: 0,
            logprobs: null,
            finish_reason: mapFinishReasonToOpenAi(finishReason),
          },
        ],
        usage: createOpenAiUsage(totalUsage),
      });
    } catch (error: any) {
      await recordAutocompleteUsage({
        agentId,
        userAgent: req.headers.get("user-agent"),
        request: requestBody,
        status: req.signal.aborted ? "cancelled" : "error",
        errorMessage:
          error?.message || "Failed to complete autocomplete request",
      });

      return NextResponse.json(
        {
          error: {
            message:
              error?.message || "Failed to complete autocomplete request",
            type: "server_error",
          },
        },
        { status: 500 },
      );
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let responsePreviewText = "";
      let finishSent = false;

      const send = (payload: unknown) => {
        controller.enqueue(encodeSseData(JSON.stringify(payload)));
      };

      try {
        for await (const part of run.fullStream) {
          if (part.type === "text-delta") {
            responsePreviewText = summarizeExternalPreview(
              `${responsePreviewText}${part.text}`,
              280,
            );
            send(
              createCompletionChunk({
                id: completionId,
                model: modelId,
                text: part.text,
              }),
            );
            continue;
          }

          if (part.type === "finish") {
            finishSent = true;
            send(
              createCompletionChunk({
                id: completionId,
                model: modelId,
                text: "",
                finishReason: mapFinishReasonToOpenAi(part.finishReason),
              }),
            );
          }
        }

        if (!finishSent) {
          const finishReason = await run.finishReason;
          send(
            createCompletionChunk({
              id: completionId,
              model: modelId,
              text: "",
              finishReason: mapFinishReasonToOpenAi(finishReason),
            }),
          );
        }

        const [finishReason, totalUsage] = await Promise.all([
          run.finishReason,
          run.totalUsage,
        ]);

        await recordAutocompleteUsage({
          agentId,
          userAgent: req.headers.get("user-agent"),
          request: requestBody,
          responsePreview: responsePreviewText,
          finishReason,
          usage: totalUsage,
        });

        controller.enqueue(encodeSseData("[DONE]"));
        controller.close();
      } catch (error: any) {
        await recordAutocompleteUsage({
          agentId,
          userAgent: req.headers.get("user-agent"),
          request: requestBody,
          responsePreview: responsePreviewText,
          status: req.signal.aborted ? "cancelled" : "error",
          errorMessage:
            error?.message || "Failed to stream autocomplete request",
        });
        controller.error(
          new Error(error?.message || "Failed to stream autocomplete request"),
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
