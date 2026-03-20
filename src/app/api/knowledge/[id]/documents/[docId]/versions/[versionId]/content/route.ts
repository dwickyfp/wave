import { getSession } from "auth/server";
import { knowledgeRepository } from "lib/db/repository";
import { getDocumentVersionContent } from "lib/knowledge/versioning";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string; docId: string; versionId: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: groupId, docId, versionId } = await params;
  const group = await knowledgeRepository.selectGroupById(
    groupId,
    session.user.id,
  );
  if (!group) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const doc = await knowledgeRepository.selectDocumentById(docId);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (doc.groupId !== groupId) {
    const sources = await knowledgeRepository.selectGroupSources(groupId);
    const hasAccess = sources.some(
      (source) => source.sourceGroupId === doc.groupId,
    );
    if (!hasAccess) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const versionContent = await getDocumentVersionContent(docId, versionId);
  if (!versionContent) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(versionContent);
}
