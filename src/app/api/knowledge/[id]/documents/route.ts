import { createHash } from "node:crypto";
import { DocumentFileType } from "app-types/knowledge";
import { getSession } from "auth/server";
import { isCreatorRole } from "lib/auth/types";
import { knowledgeRepository } from "lib/db/repository";
import { serverFileStorage } from "lib/file-storage";
import {
  assertKnowledgeDocumentSize,
  StorageUploadPolicyError,
} from "lib/file-storage/upload-policy";
import { reconcileDocumentIngestFailure } from "lib/knowledge/versioning";
import { enqueueIngestDocument } from "lib/knowledge/worker-client";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string }>;
}

const MIME_TO_TYPE: Record<string, DocumentFileType> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/msword": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xlsx",
  "text/csv": "csv",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/html": "html",
};

function buildSha256Fingerprint(
  input: Buffer | string,
  prefix: string,
): string {
  return createHash("sha256")
    .update(prefix)
    .update(":")
    .update(input)
    .digest("hex");
}

function normalizeSourceUrl(sourceUrl: string): string {
  const url = new URL(sourceUrl);
  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  const sorted = Array.from(url.searchParams.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  url.search = "";
  for (const [key, value] of sorted) {
    url.searchParams.append(key, value);
  }

  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

function tryNormalizeSourceUrl(sourceUrl: string): string | null {
  try {
    return normalizeSourceUrl(sourceUrl);
  } catch {
    return null;
  }
}

function parsePaginationParams(request: NextRequest): {
  limit?: number;
  offset?: number;
} {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const offsetParam = request.nextUrl.searchParams.get("offset");

  const limit =
    limitParam === null ? undefined : Number.parseInt(limitParam, 10);
  const offset =
    offsetParam === null ? undefined : Number.parseInt(offsetParam, 10);

  return {
    limit:
      limit !== undefined && Number.isFinite(limit) && limit > 0
        ? Math.min(limit, 100)
        : undefined,
    offset:
      offset !== undefined && Number.isFinite(offset) && offset >= 0
        ? offset
        : undefined,
  };
}

async function findExistingDocumentByFingerprint(
  groupId: string,
  fingerprint: string,
) {
  return knowledgeRepository.selectDocumentByFingerprint(groupId, fingerprint);
}

async function findExistingUrlDocument(
  groupId: string,
  sourceUrl: string,
  fingerprint: string,
) {
  const byFingerprint = await findExistingDocumentByFingerprint(
    groupId,
    fingerprint,
  );
  if (byFingerprint) {
    return byFingerprint;
  }

  const normalizedSourceUrl = normalizeSourceUrl(sourceUrl);
  return (
    (await knowledgeRepository.selectUrlDocumentBySourceUrl(
      groupId,
      normalizedSourceUrl,
    )) ??
    (normalizedSourceUrl !== sourceUrl
      ? await knowledgeRepository.selectUrlDocumentBySourceUrl(
          groupId,
          sourceUrl,
        )
      : null)
  );
}

async function findExistingFileDocument(input: {
  groupId: string;
  fingerprint: string;
  originalFilename: string;
  fileType: DocumentFileType;
  fileSize: number;
}) {
  const byFingerprint = await findExistingDocumentByFingerprint(
    input.groupId,
    input.fingerprint,
  );
  if (byFingerprint) {
    return byFingerprint;
  }

  return knowledgeRepository.selectFileDocumentByNameAndSize(input);
}

async function enqueueDocumentIngestOrFail(
  documentId: string,
  groupId: string,
): Promise<void> {
  try {
    await enqueueIngestDocument(documentId, groupId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await reconcileDocumentIngestFailure({
      documentId,
      errorMessage: `Failed to enqueue ingest job: ${errorMessage}`,
    }).catch(() => {});
    throw error;
  }
}

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Verify access to group
  const group = await knowledgeRepository.selectGroupById(id, session.user.id);
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { limit, offset } = parsePaginationParams(req);
  if (limit !== undefined || offset !== undefined) {
    const docs = await knowledgeRepository.selectDocumentsPageByGroupScope(id, {
      limit: limit ?? 20,
      offset: offset ?? 0,
    });
    return NextResponse.json(docs);
  }

  const docs = await knowledgeRepository.selectDocumentsByGroupScope(id);
  return NextResponse.json(docs);
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isCreatorRole(session.user.role)) {
    return NextResponse.json(
      { error: "Only creators and admins can manage ContextX" },
      { status: 403 },
    );
  }

  const { id: groupId } = await params;

  // Verify access to group
  const group = await knowledgeRepository.selectGroupById(
    groupId,
    session.user.id,
  );
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (group.userId !== session.user.id) {
    return NextResponse.json(
      { error: "Only the group owner can upload documents" },
      { status: 403 },
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await req.json()) as {
      sourceUrl?: string;
      name?: string;
    };
    const sourceUrl = body.sourceUrl?.trim();
    if (!sourceUrl) {
      return NextResponse.json(
        { error: "sourceUrl is required" },
        { status: 400 },
      );
    }
    const normalizedSourceUrl = tryNormalizeSourceUrl(sourceUrl);
    if (!normalizedSourceUrl) {
      return NextResponse.json({ error: "Invalid sourceUrl" }, { status: 400 });
    }
    const fingerprint = buildSha256Fingerprint(normalizedSourceUrl, "url");
    const existing = await findExistingUrlDocument(
      groupId,
      sourceUrl,
      fingerprint,
    );
    if (existing) {
      return NextResponse.json({ ...existing, duplicate: true });
    }
    const doc = await knowledgeRepository.insertDocument({
      groupId,
      userId: session.user.id,
      name: body.name?.trim() || new URL(sourceUrl).hostname,
      originalFilename: sourceUrl,
      fileType: "url",
      sourceUrl: normalizedSourceUrl,
      fingerprint,
    });
    try {
      await enqueueDocumentIngestOrFail(doc.id, groupId);
    } catch {
      return NextResponse.json(
        {
          error:
            "Knowledge ingest workers are unavailable. Please retry shortly.",
          documentId: doc.id,
        },
        { status: 503 },
      );
    }
    return NextResponse.json(doc, { status: 201 });
  }

  const formData = await req.formData();

  // Handle URL source
  const sourceUrl = (formData.get("sourceUrl") as string | null)?.trim();
  if (sourceUrl) {
    const name = ((formData.get("name") as string) || "").trim();
    const normalizedSourceUrl = tryNormalizeSourceUrl(sourceUrl);
    if (!normalizedSourceUrl) {
      return NextResponse.json({ error: "Invalid sourceUrl" }, { status: 400 });
    }
    const fingerprint = buildSha256Fingerprint(normalizedSourceUrl, "url");
    const existing = await findExistingUrlDocument(
      groupId,
      sourceUrl,
      fingerprint,
    );
    if (existing) {
      return NextResponse.json({ ...existing, duplicate: true });
    }
    const doc = await knowledgeRepository.insertDocument({
      groupId,
      userId: session.user.id,
      name: name || new URL(sourceUrl).hostname,
      originalFilename: sourceUrl,
      fileType: "url",
      sourceUrl: normalizedSourceUrl,
      fingerprint,
    });
    try {
      await enqueueDocumentIngestOrFail(doc.id, groupId);
    } catch {
      return NextResponse.json(
        {
          error:
            "Knowledge ingest workers are unavailable. Please retry shortly.",
          documentId: doc.id,
        },
        { status: 503 },
      );
    }
    return NextResponse.json(doc, { status: 201 });
  }

  // Handle file upload
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json(
      { error: "No file or sourceUrl provided" },
      { status: 400 },
    );
  }

  try {
    assertKnowledgeDocumentSize(file.size);
  } catch (error) {
    if (error instanceof StorageUploadPolicyError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    throw error;
  }

  const fileType = MIME_TO_TYPE[file.type] ?? "txt";
  const buffer = Buffer.from(await file.arrayBuffer());
  const fingerprint = buildSha256Fingerprint(buffer, "file");
  const existing = await findExistingFileDocument({
    groupId,
    fingerprint,
    originalFilename: file.name,
    fileType,
    fileSize: file.size,
  });
  if (existing) {
    return NextResponse.json({ ...existing, duplicate: true });
  }

  // Persist the file to object storage so worker processes can ingest it.
  let storagePath: string;
  try {
    const uploadResult = await serverFileStorage.upload(buffer, {
      filename: `knowledge/${groupId}/${Date.now()}-${file.name}`,
      contentType: file.type || "application/octet-stream",
    });
    storagePath = uploadResult.key;
  } catch (uploadErr) {
    console.error(
      "[ContextX] File storage unavailable for ingest request:",
      uploadErr,
    );
    return NextResponse.json(
      {
        error:
          "File storage is unavailable. Document uploads require shared object storage.",
      },
      { status: 503 },
    );
  }

  const doc = await knowledgeRepository.insertDocument({
    groupId,
    userId: session.user.id,
    name: (formData.get("name") as string) || file.name,
    originalFilename: file.name,
    fileType,
    fileSize: file.size,
    storagePath,
    fingerprint,
  });

  try {
    await enqueueDocumentIngestOrFail(doc.id, groupId);
  } catch {
    return NextResponse.json(
      {
        error:
          "Knowledge ingest workers are unavailable. Please retry shortly.",
        documentId: doc.id,
      },
      { status: 503 },
    );
  }

  return NextResponse.json(doc, { status: 201 });
}
