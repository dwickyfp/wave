import { buildPublishedA2ACardForRequest } from "lib/a2a/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params;
  const card = await buildPublishedA2ACardForRequest(agentId, request);

  if (!card) {
    return Response.json({ error: "A2A agent not found" }, { status: 404 });
  }

  return Response.json(card);
}
