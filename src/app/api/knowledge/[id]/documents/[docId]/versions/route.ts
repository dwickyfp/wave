import { getSession } from "auth/server";
import { isCreatorRole } from "lib/auth/types";
import { knowledgeRepository } from "lib/db/repository";
import {
  createMarkdownEditVersion,
  isKnowledgeVersionConflictError,
  markDocumentVersionFailed,
} from "lib/knowledge/versioning";
import { enqueueMaterializeDocumentVersion } from "lib/knowledge/worker-client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const createVersionSchema = z.object({
  markdownContent: z.string(),
  expectedActiveVersionId: z.string().uuid().nullable().optional(),
  baseVersionId: z.string().uuid().nullable().optional(),
});

interface Params {
  params: Promise<{ id: string; docId: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
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
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (group.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const doc = await knowledgeRepository.selectDocumentById(docId);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.groupId !== groupId) {
    const sources = await knowledgeRepository.selectGroupSources(groupId);
    const isInherited = sources.some(
      (source) => source.sourceGroupId === doc.groupId,
    );
    return NextResponse.json(
      {
        error: isInherited ? "Inherited documents are read-only" : "Not found",
      },
      { status: isInherited ? 403 : 404 },
    );
  }

  const parsed = createVersionSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const version = await createMarkdownEditVersion({
      documentId: docId,
      actorUserId: session.user.id,
      markdownContent: parsed.data.markdownContent,
      expectedActiveVersionId:
        parsed.data.expectedActiveVersionId ??
        parsed.data.baseVersionId ??
        null,
    });

    try {
      await enqueueMaterializeDocumentVersion({
        versionId: version.id,
        expectedActiveVersionId:
          parsed.data.expectedActiveVersionId ??
          parsed.data.baseVersionId ??
          null,
      });
    } catch (error) {
      await markDocumentVersionFailed({
        versionId: version.id,
        errorMessage: error instanceof Error ? error.message : String(error),
        updateDocumentStatus: false,
      });
      throw error;
    }

    return NextResponse.json({ queued: true, version }, { status: 202 });
  } catch (error) {
    if (isKnowledgeVersionConflictError(error)) {
      return NextResponse.json(
        { error: "Document version changed. Refresh and try again." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to queue document edit",
      },
      { status: 500 },
    );
  }
}
