import { getSession } from "auth/server";
import { knowledgeRepository } from "lib/db/repository";
import { serverFileStorage } from "lib/file-storage";
import { withKnowledgeImageAssetUrl } from "lib/knowledge/document-images";
import { parsePageMarker } from "lib/knowledge/page-markers";
import {
  getDocumentVersionContent,
  listDocumentVersions,
} from "lib/knowledge/versioning";
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

type MarkdownPageSlice = {
  pageNumber: number;
  normalized: string;
  tokenSet: Set<string>;
};

function normalizeCitationLookupText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/<!--CTX_PAGE:\d+-->/g, " ")
    .replace(/`{1,3}[^`]*`{1,3}/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenizeCitationLookupText(value: string): string[] {
  return Array.from(
    new Set(
      normalizeCitationLookupText(value)
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4),
    ),
  );
}

function splitMarkdownIntoPageSlices(markdown: string): MarkdownPageSlice[] {
  const pages: MarkdownPageSlice[] = [];
  let currentPage = 1;
  let currentLines: string[] = [];

  const flush = () => {
    const normalized = normalizeCitationLookupText(currentLines.join("\n"));
    if (!normalized) return;

    pages.push({
      pageNumber: currentPage,
      normalized,
      tokenSet: new Set(tokenizeCitationLookupText(normalized)),
    });
  };

  for (const line of markdown.split("\n")) {
    const pageMarker = parsePageMarker(line.trim());
    if (pageMarker != null) {
      flush();
      currentPage = pageMarker;
      currentLines = [];
      continue;
    }

    currentLines.push(line);
  }

  flush();
  return pages;
}

function scorePageSliceForSnippet(
  page: MarkdownPageSlice,
  normalizedSnippet: string,
  snippetTokens: string[],
): number {
  if (!normalizedSnippet) return 0;

  const anchors = [
    normalizedSnippet,
    normalizedSnippet.slice(0, 160),
    normalizedSnippet.slice(0, 96),
    normalizedSnippet.slice(0, 64),
    normalizedSnippet.slice(0, 40),
  ].filter((anchor, index, items) => {
    return anchor.length >= 24 && items.indexOf(anchor) === index;
  });

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    if (page.normalized.includes(anchor)) {
      return 1000 - index * 100 + anchor.length / 1000;
    }
  }

  if (snippetTokens.length === 0) return 0;

  const overlapCount = snippetTokens.filter((token) =>
    page.tokenSet.has(token),
  ).length;
  const overlapRatio = overlapCount / snippetTokens.length;
  return overlapRatio >= 0.45 ? overlapRatio : 0;
}

function inferCitationPageFromMarkdown(input: {
  markdown: string;
  excerpt?: string | null;
}): number | null {
  if (!input.excerpt?.trim()) return null;

  const markerMatch = input.excerpt.match(/<!--CTX_PAGE:(\d+)-->/);
  if (markerMatch) {
    const pageNumber = Number.parseInt(markerMatch[1], 10);
    if (Number.isFinite(pageNumber)) return pageNumber;
  }

  const pages = splitMarkdownIntoPageSlices(input.markdown);
  if (pages.length === 0) return null;

  const normalizedSnippet = normalizeCitationLookupText(input.excerpt);
  if (normalizedSnippet.length < 24) return null;

  const snippetTokens = tokenizeCitationLookupText(input.excerpt);
  let bestPage: number | null = null;
  let bestScore = 0;

  for (const page of pages) {
    const score = scorePageSliceForSnippet(
      page,
      normalizedSnippet,
      snippetTokens,
    );
    if (score > bestScore) {
      bestScore = score;
      bestPage = page.pageNumber;
    }
  }

  return bestScore > 0 ? bestPage : null;
}

function parseOptionalPage(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveCitationPageBounds(input: {
  markdown?: string | null;
  excerpt?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
}): { pageStart: number | null; pageEnd: number | null } {
  const existingPageStart = input.pageStart ?? null;
  const existingPageEnd = input.pageEnd ?? null;

  if (
    existingPageStart != null &&
    existingPageEnd != null &&
    existingPageStart === existingPageEnd
  ) {
    return { pageStart: existingPageStart, pageEnd: existingPageEnd };
  }

  if (!input.markdown?.trim()) {
    return { pageStart: existingPageStart, pageEnd: existingPageEnd };
  }

  const inferredPage = inferCitationPageFromMarkdown({
    markdown: input.markdown,
    excerpt: input.excerpt,
  });

  if (inferredPage != null) {
    return { pageStart: inferredPage, pageEnd: inferredPage };
  }

  return { pageStart: existingPageStart, pageEnd: existingPageEnd };
}

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
  const requestedVersionId = _req.nextUrl.searchParams.get("versionId");
  const citationExcerpt = _req.nextUrl.searchParams.get("excerpt");
  const citationPageStart = parseOptionalPage(
    _req.nextUrl.searchParams.get("pageStart"),
  );
  const citationPageEnd = parseOptionalPage(
    _req.nextUrl.searchParams.get("pageEnd"),
  );

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
  const requestedVersion = requestedVersionId
    ? (versions.find((version) => version.id === requestedVersionId) ?? null)
    : null;
  if (requestedVersionId && !requestedVersion) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const resolvedVersion = requestedVersion ?? activeVersion;
  const binaryMatchesRequestedVersion =
    !requestedVersionId ||
    requestedVersionId === activeVersion?.id ||
    requestedVersionId === doc.activeVersionId;
  const fallbackWarning =
    requestedVersionId && !binaryMatchesRequestedVersion
      ? "Showing the current document binary because historical file snapshots are not stored separately for this version."
      : null;
  const activeImages = resolvedVersion?.id
    ? await knowledgeRepository.getDocumentImagesByVersion(
        docId,
        resolvedVersion.id,
      )
    : await knowledgeRepository.getDocumentImages(docId);
  const versionContent =
    resolvedVersion?.id && resolvedVersion.id !== activeVersion?.id
      ? await getDocumentVersionContent(docId, resolvedVersion.id)
      : null;

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
  const resolvedMarkdownContent =
    versionContent?.markdownContent ?? doc.markdownContent ?? null;
  const resolvedCitationPages = resolveCitationPageBounds({
    markdown: resolvedMarkdownContent,
    excerpt: citationExcerpt,
    pageStart: citationPageStart,
    pageEnd: citationPageEnd,
  });

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
        embeddingTokenCount: doc.embeddingTokenCount ?? 0,
        processingState: doc.processingState ?? null,
      },
      assetUrl: null,
      sourceUrl: doc.sourceUrl ?? null,
      previewUrl: null,
      content: versionContent?.markdownContent ?? doc.markdownContent ?? null,
      markdownAvailable:
        Boolean(activeVersion?.id) || Boolean(doc.markdownContent),
      isUrlOnly: true,
      requestedVersionId,
      resolvedVersionId: resolvedVersion?.id ?? doc.activeVersionId ?? null,
      resolvedCitationPageStart: resolvedCitationPages.pageStart,
      resolvedCitationPageEnd: resolvedCitationPages.pageEnd,
      binaryMatchesRequestedVersion,
      fallbackWarning,
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
        embeddingTokenCount: doc.embeddingTokenCount ?? 0,
        processingState: doc.processingState ?? null,
      },
      assetUrl: `/api/knowledge/${groupId}/documents/${docId}/asset${resolvedVersion?.id ? `?versionId=${encodeURIComponent(resolvedVersion.id)}` : ""}`,
      previewUrl,
      sourceUrl: doc.sourceUrl ?? null,
      content: versionContent?.markdownContent ?? content,
      markdownAvailable:
        Boolean(activeVersion?.id) || Boolean(doc.markdownContent),
      isUrlOnly: false,
      requestedVersionId,
      resolvedVersionId: resolvedVersion?.id ?? doc.activeVersionId ?? null,
      resolvedCitationPageStart: resolvedCitationPages.pageStart,
      resolvedCitationPageEnd: resolvedCitationPages.pageEnd,
      binaryMatchesRequestedVersion,
      fallbackWarning,
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
