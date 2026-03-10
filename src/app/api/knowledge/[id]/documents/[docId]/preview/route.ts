import { getSession } from "auth/server";
import { knowledgeRepository } from "lib/db/repository";
import { serverFileStorage } from "lib/file-storage";
import { withKnowledgeImageAssetUrl } from "lib/knowledge/document-images";
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
  txt: "text/plain",
  md: "text/markdown",
  html: "text/html",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/**
 * GET /api/knowledge/[id]/documents/[docId]/preview
 *
 * Returns a signed/public URL for preview, plus metadata.
 * For small text files it also includes the raw text content.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: groupId, docId } = await params;

  // Verify group access
  const group = await knowledgeRepository.selectGroupById(
    groupId,
    session.user.id,
  );
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const doc = await knowledgeRepository.selectDocumentById(docId);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const versions = await listDocumentVersions(docId);
  const activeVersion = versions.find((version) => version.isActive) ?? null;
  const activeImages = activeVersion?.id
    ? await knowledgeRepository.getDocumentImagesByVersion(
        docId,
        activeVersion.id,
      )
    : await knowledgeRepository.getDocumentImages(docId);

  let sourceMeta: {
    id: string;
    name: string;
    visibility: "public" | "private" | "readonly";
    userName?: string;
  } | null = null;
  if (doc.groupId !== groupId) {
    const sources = await knowledgeRepository.selectGroupSources(groupId);
    const source = sources.find((s) => s.sourceGroupId === doc.groupId);
    if (!source) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    sourceMeta = {
      id: source.sourceGroupId,
      name: source.sourceGroupName,
      visibility: source.sourceGroupVisibility,
      userName: source.sourceGroupUserName,
    };
  }

  const mimeType = FILE_MIME_TYPES[doc.fileType] ?? "application/octet-stream";
  const isText =
    doc.fileType === "txt" ||
    doc.fileType === "md" ||
    doc.fileType === "csv" ||
    doc.fileType === "html";

  // URL doc (no storage path)
  if (!doc.storagePath) {
    return NextResponse.json({
      ok: true,
      doc: {
        id: doc.id,
        name: doc.name,
        description: doc.description ?? null,
        descriptionManual: doc.descriptionManual ?? false,
        titleManual: doc.titleManual ?? false,
        isInherited: !!sourceMeta,
        sourceGroupId: sourceMeta?.id ?? null,
        sourceGroupName: sourceMeta?.name ?? null,
        sourceGroupVisibility: sourceMeta?.visibility ?? null,
        sourceGroupUserName: sourceMeta?.userName ?? null,
        originalFilename: doc.originalFilename,
        fileType: doc.fileType,
        fileSize: doc.fileSize,
        mimeType,
        activeVersionId: doc.activeVersionId ?? null,
        latestVersionNumber: doc.latestVersionNumber ?? 0,
      },
      sourceUrl: doc.sourceUrl ?? null,
      previewUrl: null,
      content: null,
      markdownContent: doc.markdownContent ?? null,
      isUrlOnly: true,
      activeVersionId: activeVersion?.id ?? doc.activeVersionId ?? null,
      activeVersionNumber:
        activeVersion?.versionNumber ?? doc.latestVersionNumber ?? null,
      versions,
      images: withKnowledgeImageAssetUrl(groupId, activeImages),
    });
  }

  try {
    // Try to get a signed download URL first
    let previewUrl: string | null = null;

    if (serverFileStorage.getDownloadUrl) {
      previewUrl = await serverFileStorage.getDownloadUrl(doc.storagePath);
    }

    // If no signed URL available, try public source URL
    if (!previewUrl) {
      previewUrl = await serverFileStorage.getSourceUrl(doc.storagePath);
    }

    // For small text files, also include raw content
    let content: string | null = null;
    if (isText && doc.fileSize && doc.fileSize < 500_000) {
      try {
        const buf = await serverFileStorage.download(doc.storagePath);
        content = buf.toString("utf-8");
      } catch {
        // ignore
      }
    }

    return NextResponse.json({
      ok: true,
      doc: {
        id: doc.id,
        name: doc.name,
        description: doc.description ?? null,
        descriptionManual: doc.descriptionManual ?? false,
        titleManual: doc.titleManual ?? false,
        isInherited: !!sourceMeta,
        sourceGroupId: sourceMeta?.id ?? null,
        sourceGroupName: sourceMeta?.name ?? null,
        sourceGroupVisibility: sourceMeta?.visibility ?? null,
        sourceGroupUserName: sourceMeta?.userName ?? null,
        originalFilename: doc.originalFilename,
        fileType: doc.fileType,
        fileSize: doc.fileSize,
        mimeType,
        activeVersionId: doc.activeVersionId ?? null,
        latestVersionNumber: doc.latestVersionNumber ?? 0,
      },
      previewUrl,
      content,
      markdownContent: doc.markdownContent ?? null,
      isUrlOnly: false,
      activeVersionId: activeVersion?.id ?? doc.activeVersionId ?? null,
      activeVersionNumber:
        activeVersion?.versionNumber ?? doc.latestVersionNumber ?? null,
      versions,
      images: withKnowledgeImageAssetUrl(groupId, activeImages),
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to generate preview URL" },
      { status: 500 },
    );
  }
}
