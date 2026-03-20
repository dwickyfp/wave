import { getSession } from "auth/server";
import { isCreatorRole } from "lib/auth/types";
import { knowledgeRepository } from "lib/db/repository";
import { serverFileStorage } from "lib/file-storage";
import { buildDocumentMetadataEmbeddingText } from "lib/knowledge/document-metadata";
import { embedSingleText } from "lib/knowledge/embedder";
import { reconcileDocumentIngestFailure } from "lib/knowledge/versioning";
import {
  cancelIngestDocument,
  enqueueIngestDocument,
} from "lib/knowledge/worker-client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const DOC_META_VECTOR_ENABLED = process.env.DOC_META_VECTOR_ENABLED !== "false";
const updateDocumentMetadataSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => v.title !== undefined || v.description !== undefined, {
    message: "At least one field must be provided",
  });

interface Params {
  params: Promise<{ id: string; docId: string }>;
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

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: groupId, docId } = await params;
  const group = await knowledgeRepository.selectGroupById(
    groupId,
    session.user.id,
  );
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const doc = await knowledgeRepository.selectDocumentById(docId);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (doc.groupId === groupId) {
    return NextResponse.json({
      ...doc,
      isInherited: false,
      sourceGroupId: null,
      sourceGroupName: null,
      sourceGroupVisibility: null,
      sourceGroupUserName: null,
    });
  }

  const sources = await knowledgeRepository.selectGroupSources(groupId);
  const source = sources.find((s) => s.sourceGroupId === doc.groupId);
  if (!source)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    ...doc,
    isInherited: true,
    sourceGroupId: source.sourceGroupId,
    sourceGroupName: source.sourceGroupName,
    sourceGroupVisibility: source.sourceGroupVisibility,
    sourceGroupUserName: source.sourceGroupUserName ?? null,
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isCreatorRole(session.user.role)) {
    return NextResponse.json(
      { error: "Only creators and admins can manage ContextX documents" },
      { status: 403 },
    );
  }

  const { id: groupId, docId } = await params;

  // Verify group access
  const group = await knowledgeRepository.selectGroupById(
    groupId,
    session.user.id,
  );
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (group.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const doc = await knowledgeRepository.selectDocumentById(docId);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.groupId !== groupId) {
    const sources = await knowledgeRepository.selectGroupSources(groupId);
    const isInherited = sources.some((s) => s.sourceGroupId === doc.groupId);
    return NextResponse.json(
      {
        error: isInherited ? "Inherited documents are read-only" : "Not found",
      },
      { status: isInherited ? 403 : 404 },
    );
  }

  // Delete from storage
  if (doc.storagePath) {
    await serverFileStorage.delete(doc.storagePath).catch(() => {});
  }
  await cancelIngestDocument(docId).catch((error) => {
    console.warn(
      `[ContextX] Failed to cancel ingest jobs before deleting document ${docId}:`,
      error,
    );
  });
  const imageStoragePaths =
    await knowledgeRepository.listDocumentImageStoragePaths(docId);
  await Promise.all(
    imageStoragePaths.map((path) =>
      serverFileStorage.delete(path).catch(() => {}),
    ),
  );

  // Cascade deletes chunks too
  await knowledgeRepository.deleteDocument(docId);
  return NextResponse.json({ success: true });
}

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isCreatorRole(session.user.role)) {
    return NextResponse.json(
      { error: "Only creators and admins can manage ContextX documents" },
      { status: 403 },
    );
  }

  const { id: groupId, docId } = await params;

  // Verify group access
  const group = await knowledgeRepository.selectGroupById(
    groupId,
    session.user.id,
  );
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (group.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const doc = await knowledgeRepository.selectDocumentById(docId);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.groupId !== groupId) {
    const sources = await knowledgeRepository.selectGroupSources(groupId);
    const isInherited = sources.some((s) => s.sourceGroupId === doc.groupId);
    return NextResponse.json(
      {
        error: isInherited ? "Inherited documents are read-only" : "Not found",
      },
      { status: isInherited ? 403 : 404 },
    );
  }

  if (doc.activeVersionId) {
    await knowledgeRepository.updateDocumentProcessing(docId, {
      errorMessage: null,
      processingProgress: 0,
      processingState: { stage: "extracting" },
    });
  } else {
    await knowledgeRepository.updateDocumentStatus(docId, "pending", {
      processingProgress: null,
      processingState: null,
    });
  }

  try {
    await enqueueDocumentIngestOrFail(docId, groupId);
  } catch {
    return NextResponse.json(
      {
        error:
          "Document was saved but ContextX workers are unavailable. Please retry shortly.",
        documentId: docId,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ success: true });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isCreatorRole(session.user.role)) {
    return NextResponse.json(
      { error: "Only creators and admins can manage ContextX documents" },
      { status: 403 },
    );
  }

  const { id: groupId, docId } = await params;
  const group = await knowledgeRepository.selectGroupById(
    groupId,
    session.user.id,
  );
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (group.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const doc = await knowledgeRepository.selectDocumentById(docId);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.groupId !== groupId) {
    const sources = await knowledgeRepository.selectGroupSources(groupId);
    const isInherited = sources.some((s) => s.sourceGroupId === doc.groupId);
    return NextResponse.json(
      {
        error: isInherited ? "Inherited documents are read-only" : "Not found",
      },
      { status: isInherited ? 403 : 404 },
    );
  }

  const parsed = updateDocumentMetadataSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const title = parsed.data.title;
  const description = parsed.data.description;
  const updatePayload: {
    title?: string;
    description?: string | null;
    metadataEmbedding?: number[] | null;
  } = {};

  if (title !== undefined) updatePayload.title = title;
  if (description !== undefined) updatePayload.description = description;

  if (DOC_META_VECTOR_ENABLED) {
    const embeddingTitle = title ?? doc.name;
    const embeddingDescription =
      description !== undefined ? description : (doc.description ?? null);
    const metadataText = buildDocumentMetadataEmbeddingText({
      title: embeddingTitle,
      description: embeddingDescription,
      originalFilename: doc.originalFilename,
      sourceUrl: doc.sourceUrl,
    });
    if (metadataText) {
      try {
        updatePayload.metadataEmbedding = await embedSingleText(
          metadataText,
          group.embeddingProvider,
          group.embeddingModel,
          { cache: false },
        );
      } catch (err) {
        console.warn(
          `[ContextX] Failed to update metadata embedding for document ${docId}:`,
          err,
        );
      }
    }
  }

  const updated = await knowledgeRepository.updateDocumentMetadata(
    docId,
    session.user.id,
    updatePayload,
  );
  if (!updated) {
    return NextResponse.json(
      { error: "Not found or unauthorized" },
      { status: 404 },
    );
  }

  return NextResponse.json(updated);
}
