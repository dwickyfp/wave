import { agentRepository, snowflakeAgentRepository } from "lib/db/repository";
import { getSession } from "auth/server";
import { callSnowflakeCortexStream } from "lib/snowflake/client";
import { z } from "zod";

const QueryBodySchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
    }),
  ),
});

/**
 * POST /api/agent/snowflake/[id]/query
 * Proxies a chat message to the Snowflake Cortex Agent and streams the response.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const { id } = await params;

    const hasAccess = await agentRepository.checkAccess(id, session.user.id);
    if (!hasAccess) {
      return new Response("Unauthorized", { status: 401 });
    }

    const agent = await agentRepository.selectAgentById(id, session.user.id);
    if (!agent || (agent as any).agentType !== "snowflake_cortex") {
      return Response.json(
        { error: "Agent is not a Snowflake Intelligence agent" },
        { status: 400 },
      );
    }

    const config =
      await snowflakeAgentRepository.selectSnowflakeConfigByAgentId(id);
    if (!config) {
      return Response.json(
        { error: "Snowflake configuration not found for this agent" },
        { status: 404 },
      );
    }

    const body = await request.json();
    const { messages } = QueryBodySchema.parse(body);

    // Stream the response from Snowflake Cortex back to the client
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of callSnowflakeCortexStream({
            config,
            messages,
          })) {
            controller.enqueue(encoder.encode(chunk));
          }
        } catch (err) {
          console.error("Snowflake Cortex streaming error:", err);
          const message =
            err instanceof Error ? err.message : "Snowflake request failed";
          controller.enqueue(encoder.encode(`\n\nError: ${message}`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid request body", details: error.message },
        { status: 400 },
      );
    }
    console.error("Failed to query Snowflake agent:", error);
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
