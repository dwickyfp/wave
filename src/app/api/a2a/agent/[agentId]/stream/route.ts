import { handlePublishedA2AJsonRpcRequest } from "lib/a2a/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params;

  return handlePublishedA2AJsonRpcRequest({
    agentId,
    request,
  });
}
