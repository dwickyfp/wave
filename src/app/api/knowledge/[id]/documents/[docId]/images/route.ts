import { getSession } from "auth/server";
import { knowledgeRepository } from "lib/db/repository";
import { withKnowledgeImageAssetUrl } from "lib/knowledge/document-images";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string; docId: string }>;
}

export async function GET(req: NextRequest, { params }: Params) {
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
    const source = sources.find((entry) => entry.sourceGroupId === doc.groupId);
    if (!source) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const searchParams =
    req.nextUrl?.searchParams ?? new URL(req.url).searchParams;
  const versionId = searchParams.get("versionId");
  const images = versionId
    ? await knowledgeRepository.getDocumentImagesByVersion(docId, versionId)
    : await knowledgeRepository.getDocumentImages(docId);

  return NextResponse.json({
    images: withKnowledgeImageAssetUrl(groupId, images),
  });
}
