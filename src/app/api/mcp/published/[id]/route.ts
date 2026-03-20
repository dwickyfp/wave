import { NextRequest, NextResponse } from "next/server";
import { mcpRepository } from "lib/db/repository";
import { getMcpApiError } from "lib/mcp/api-error";
import {
  authenticatePublishedMcpRequest,
  createPublishedMcpResponse,
  createPublishedMcpUnauthorizedResponse,
  validatePublishedMcpOrigin,
} from "lib/mcp/published-server";

interface Params {
  params: Promise<{ id: string }>;
}

async function handlePublishedMcpRequest(
  request: NextRequest,
  { params }: Params,
) {
  try {
    const { id } = await params;
    const server = await mcpRepository.selectById(id);

    if (!server?.publishEnabled) {
      return NextResponse.json(
        { error: "MCP publishing is not enabled for this server." },
        { status: 403 },
      );
    }

    const invalidOriginResponse = validatePublishedMcpOrigin(request);
    if (invalidOriginResponse) {
      return invalidOriginResponse;
    }

    const isAuthorized = await authenticatePublishedMcpRequest(
      request.headers,
      server,
    );

    if (!isAuthorized) {
      return createPublishedMcpUnauthorizedResponse(server);
    }

    return await createPublishedMcpResponse(request, server);
  } catch (error) {
    const resolved = getMcpApiError(error);

    return NextResponse.json(
      { error: resolved.message, message: resolved.message },
      { status: resolved.status === 500 ? 500 : 503 },
    );
  }
}

export async function GET(request: NextRequest, props: Params) {
  return handlePublishedMcpRequest(request, props);
}

export async function POST(request: NextRequest, props: Params) {
  return handlePublishedMcpRequest(request, props);
}
