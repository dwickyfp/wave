import { getSession } from "auth/server";
import { knowledgeRepository } from "lib/db/repository";
import { serverFileStorage } from "lib/file-storage";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string; docId: string; imageId: string }>;
}

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: groupId, docId, imageId } = await params;
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
  const image = versionId
    ? await knowledgeRepository.getDocumentImageByIdFromVersion(
        docId,
        versionId,
        imageId,
      )
    : await knowledgeRepository.getDocumentImageById(docId, imageId);

  if (!image?.isRenderable) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  let targetUrl = image.sourceUrl ?? null;
  if (image.storagePath) {
    targetUrl = serverFileStorage.getDownloadUrl
      ? await serverFileStorage.getDownloadUrl(image.storagePath)
      : await serverFileStorage.getSourceUrl(image.storagePath);
  }

  if (!targetUrl) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  return NextResponse.redirect(targetUrl);
}
