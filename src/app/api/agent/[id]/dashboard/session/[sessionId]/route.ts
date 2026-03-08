import { NextRequest, NextResponse } from "next/server";
import { getSession } from "auth/server";
import {
  agentAnalyticsRepository,
  agentRepository,
  chatRepository,
} from "lib/db/repository";
import { z } from "zod";

interface Params {
  params: Promise<{ id: string; sessionId: string }>;
}

const querySchema = z.object({
  source: z.enum(["in_app", "external_chat"]),
});

function getMessageUsageTotals(messages: Array<{ metadata?: any }>) {
  return messages.reduce(
    (acc, message) => {
      const usage = message.metadata?.usage;
      acc.promptTokens += Number(usage?.inputTokens ?? 0);
      acc.completionTokens += Number(usage?.outputTokens ?? 0);
      acc.totalTokens += Number(
        usage?.totalTokens ??
          Number(usage?.inputTokens ?? 0) + Number(usage?.outputTokens ?? 0),
      );
      return acc;
    },
    {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
  );
}

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: agentId, sessionId } = await params;
  const agent = await agentRepository.selectAgentById(agentId, session.user.id);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  if (agent.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (agent.agentType === "snowflake_cortex") {
    return NextResponse.json(
      { error: "Dashboard is only available for base agents" },
      { status: 400 },
    );
  }

  const { source } = querySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );

  if (source === "external_chat") {
    const detail = await agentAnalyticsRepository.getExternalChatSessionDetail(
      agentId,
      sessionId,
    );

    if (!detail) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json(detail);
  }

  const thread = await chatRepository.selectThreadDetails(sessionId);
  if (!thread || thread.userId !== session.user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const hasAgentMessages = thread.messages.some(
    (message) => message.metadata?.agentId === agentId,
  );
  if (!hasAgentMessages) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const usage = getMessageUsageTotals(thread.messages);
  const updatedAt =
    thread.messages.at(-1)?.createdAt?.toISOString() ??
    thread.createdAt.toISOString();

  return NextResponse.json({
    source: "in_app",
    sessionId: thread.id,
    title: thread.title || "Untitled session",
    summary: null,
    transcriptMode: "full",
    totalTurns: thread.messages.filter(
      (message) => message.role === "assistant",
    ).length,
    totalTokens: usage.totalTokens,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    status: null,
    modelProvider: null,
    modelName: null,
    createdAt: thread.createdAt.toISOString(),
    updatedAt,
    messages: thread.messages.map((message) => ({
      id: message.id,
      role: message.role,
      parts: message.parts,
      metadata: message.metadata,
    })),
  });
}
