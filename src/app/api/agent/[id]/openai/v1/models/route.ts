import { NextRequest, NextResponse } from "next/server";
import {
  authenticateExternalAgentRequest,
  createUnauthorizedResponse,
  getExternalAgentAutocompleteOpenAiModelId,
  getExternalAgentOpenAiModelId,
  loadExternalAccessAgent,
} from "lib/ai/agent/external-access";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id: agentId } = await params;

  const isAuthorized = await authenticateExternalAgentRequest(
    req.headers,
    agentId,
  );
  if (!isAuthorized) {
    return createUnauthorizedResponse();
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

  return NextResponse.json({
    object: "list",
    data: [
      {
        id: getExternalAgentOpenAiModelId(agent.name),
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "wave",
      },
      ...(agent.mcpAutocompleteModelProvider && agent.mcpAutocompleteModelName
        ? [
            {
              id: getExternalAgentAutocompleteOpenAiModelId(agent.name),
              object: "model",
              created: Math.floor(Date.now() / 1000),
              owned_by: "wave",
            },
          ]
        : []),
    ],
  });
}
