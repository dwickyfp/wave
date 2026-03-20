import { getSession } from "auth/server";
import { isCreatorRole } from "lib/auth/types";
import { knowledgeRepository } from "lib/db/repository";
import { KNOWLEDGE_INGEST_CANCELED_MESSAGE } from "lib/knowledge/ingest-pipeline";
import { cancelDocumentVersionProcessing } from "lib/knowledge/versioning";
import { cancelIngestDocument } from "lib/knowledge/worker-client";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string; docId: string }>;
}

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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
  if (!group) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (group.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const doc = await knowledgeRepository.selectDocumentById(docId);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
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
  if (doc.status !== "processing" && !doc.processingState) {
    return NextResponse.json(
      { error: "Only processing documents can be canceled" },
      { status: 409 },
    );
  }

  let queueCancellation = { removed: 0, active: 0 };
  try {
    queueCancellation = await cancelIngestDocument(docId);
  } catch (error) {
    console.warn(
      `[ContextX] Failed to cancel queue jobs for document ${docId}:`,
      error,
    );
  }

  const updatedDoc = await cancelDocumentVersionProcessing({
    documentId: docId,
    errorMessage: KNOWLEDGE_INGEST_CANCELED_MESSAGE,
  });

  return NextResponse.json({
    success: true,
    queueCancellation,
    doc:
      updatedDoc ??
      ({
        ...doc,
        status: doc.activeVersionId ? "ready" : "failed",
        errorMessage: KNOWLEDGE_INGEST_CANCELED_MESSAGE,
        processingProgress: null,
        processingState: null,
      } as typeof doc),
  });
}
