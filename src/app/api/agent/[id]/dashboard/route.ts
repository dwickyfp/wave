import { NextRequest, NextResponse } from "next/server";
import { getSession } from "auth/server";
import { agentAnalyticsRepository, agentRepository } from "lib/db/repository";
import { z } from "zod";

interface Params {
  params: Promise<{ id: string }>;
}

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(30),
});

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const agent = await agentRepository.selectAgentById(id, session.user.id);
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

  const { days } = querySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );

  const stats = await agentAnalyticsRepository.getDashboardStats(id, days);
  return NextResponse.json(stats);
}
