import { getSession } from "auth/server";
import { knowledgeRepository } from "lib/db/repository";
import {
  createRollbackVersion,
  isKnowledgeRollbackModelMismatchError,
  isKnowledgeVersionConflictError,
  markDocumentVersionFailed,
} from "lib/knowledge/versioning";
import { enqueueRollbackDocumentVersion } from "lib/knowledge/worker-client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const rollbackSchema = z.object({
  expectedActiveVersionId: z.string().uuid().nullable().optional(),
});

interface Params {
  params: Promise<{ id: string; docId: string; versionId: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: groupId, docId, versionId } = await params;
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

  const parsed = rollbackSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const version = await createRollbackVersion({
      documentId: docId,
      actorUserId: session.user.id,
      rollbackFromVersionId: versionId,
      expectedActiveVersionId: parsed.data.expectedActiveVersionId ?? null,
    });

    try {
      await enqueueRollbackDocumentVersion({
        versionId: version.id,
        expectedActiveVersionId: parsed.data.expectedActiveVersionId ?? null,
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
    if (isKnowledgeRollbackModelMismatchError(error)) {
      return NextResponse.json(
        {
          error:
            "Rollback is blocked because the selected version uses a different embedding model than the current knowledge group.",
        },
        { status: 422 },
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to queue rollback version",
      },
      { status: 500 },
    );
  }
}
