import { getSession } from "auth/server";
import { knowledgeRepository } from "lib/db/repository";
import { summarizeKnowledgeDocumentById } from "lib/knowledge/document-summary";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string; docId: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, docId } = await params;
  const body = await req.json().catch(() => ({}));
  const tokens =
    typeof body?.tokens === "number" && Number.isFinite(body.tokens)
      ? body.tokens
      : undefined;

  const group = await knowledgeRepository.selectGroupById(id, session.user.id);
  if (!group) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const summary = await summarizeKnowledgeDocumentById({
    group,
    documentId: docId,
    tokens,
  });
  if (!summary) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  return NextResponse.json(summary);
}
