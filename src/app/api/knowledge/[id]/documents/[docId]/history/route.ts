import { getSession } from "auth/server";
import { knowledgeRepository } from "lib/db/repository";
import { getDocumentHistory } from "lib/knowledge/versioning";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string; docId: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: groupId, docId } = await params;
  const group = await knowledgeRepository.selectGroupById(
    groupId,
    session.user.id,
  );
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const doc = await knowledgeRepository.selectDocumentById(docId);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.groupId !== groupId) {
    const sources = await knowledgeRepository.selectGroupSources(groupId);
    const hasAccess = sources.some(
      (source) => source.sourceGroupId === doc.groupId,
    );
    if (!hasAccess) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const history = await getDocumentHistory(docId);
  return NextResponse.json({ history });
}
