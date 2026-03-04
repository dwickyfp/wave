import "server-only";

import {
  agentRepository,
  subAgentRepository,
  snowflakeAgentRepository,
} from "lib/db/repository";
import { getSession } from "auth/server";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;

  const hasAccess = await agentRepository.checkAccess(id, session.user.id);
  if (!hasAccess) {
    return new Response("Unauthorized", { status: 401 });
  }

  const agent = await agentRepository.selectAgentById(id, session.user.id);
  if (!agent) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  const subAgents = await subAgentRepository.selectSubAgentsByAgentId(id);

  // For snowflake agents, include the full config (raw private key for backup)
  let snowflakeConfig: Record<string, unknown> | null = null;
  if (agent.agentType === "snowflake_cortex") {
    const cfg =
      await snowflakeAgentRepository.selectSnowflakeConfigByAgentId(id);
    if (cfg) {
      // Strip internal DB fields
      const {
        id: _id,
        agentId: _agentId,
        createdAt: _c,
        updatedAt: _u,
        ...rest
      } = cfg as any;
      snowflakeConfig = rest;
    }
  }

  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    agentType: agent.agentType ?? "standard",
    name: agent.name,
    description: agent.description,
    icon: agent.icon,
    visibility: agent.visibility,
    subAgentsEnabled: agent.subAgentsEnabled,
    instructions: agent.instructions,
    subAgents: subAgents.map(
      ({ id: _id, agentId: _agentId, createdAt: _c, updatedAt: _u, ...sa }) =>
        sa,
    ),
    ...(snowflakeConfig ? { snowflakeConfig } : {}),
  };

  const safeName = agent.name.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  const filename = `agent-${safeName}-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
