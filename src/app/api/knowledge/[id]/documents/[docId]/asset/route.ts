import { getSession } from "auth/server";
import { knowledgeRepository } from "lib/db/repository";
import { serverFileStorage } from "lib/file-storage";
import { listDocumentVersions } from "lib/knowledge/versioning";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string; docId: string }>;
}

const FILE_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  html: "text/html; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export async function GET(request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: groupId, docId } = await params;
  const requestedVersionId = request.nextUrl.searchParams.get("versionId");

  const group = await knowledgeRepository.selectGroupById(
    groupId,
    session.user.id,
  );
  if (!group) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const doc = await knowledgeRepository.selectDocumentById(docId);
  if (!doc?.storagePath) {
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

  if (requestedVersionId) {
    const versions = await listDocumentVersions(docId);
    const versionExists = versions.some(
      (version) => version.id === requestedVersionId,
    );
    if (!versionExists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const content = await serverFileStorage.download(doc.storagePath);
  const mimeType = FILE_MIME_TYPES[doc.fileType] ?? "application/octet-stream";
  const encodedFilename = encodeURIComponent(doc.originalFilename);
  const body = new Uint8Array(content);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(content.byteLength),
      "Content-Disposition": `inline; filename*=UTF-8''${encodedFilename}`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
