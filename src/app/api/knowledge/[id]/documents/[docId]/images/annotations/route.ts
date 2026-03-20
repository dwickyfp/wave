import { getSession } from "auth/server";
import { isCreatorRole } from "lib/auth/types";
import { knowledgeRepository } from "lib/db/repository";
import { syncContextImageBlocksInMarkdown } from "lib/knowledge/document-images";
import {
  createImageAnnotationEditVersion,
  isKnowledgeVersionConflictError,
  markDocumentVersionFailed,
} from "lib/knowledge/versioning";
import { enqueueMaterializeDocumentVersion } from "lib/knowledge/worker-client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const updateImageAnnotationsSchema = z.object({
  expectedActiveVersionId: z.string().uuid().nullable().optional(),
  images: z
    .array(
      z.object({
        imageId: z.string().uuid(),
        label: z.string().trim().min(1).max(240),
        description: z.string().trim().min(1).max(4000),
        stepHint: z.string().trim().max(500).nullable().optional(),
      }),
    )
    .min(1),
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
    return NextResponse.json(
      { error: "Inherited documents are read-only" },
      { status: 403 },
    );
  }

  const parsed = updateImageAnnotationsSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const liveImages = await knowledgeRepository.getDocumentImages(docId);
  const liveImageById = new Map(liveImages.map((image) => [image.id, image]));
  const changedImages = parsed.data.images
    .map((image) => {
      const current = liveImageById.get(image.imageId);
      if (!current) return null;
      const stepHint = image.stepHint ?? null;
      const isChanged =
        current.label !== image.label ||
        current.description !== image.description ||
        (current.stepHint ?? null) !== stepHint;
      if (!isChanged) return null;
      return {
        imageId: image.imageId,
        label: image.label,
        description: image.description,
        stepHint,
      };
    })
    .filter(Boolean);

  if (changedImages.length === 0) {
    return NextResponse.json(
      { error: "No image annotation changes detected" },
      { status: 400 },
    );
  }

  const mergedImages = liveImages.map((image) => {
    const changed = changedImages.find((entry) => entry?.imageId === image.id);
    return changed
      ? {
          ...image,
          label: changed.label,
          description: changed.description,
          stepHint: changed.stepHint ?? null,
        }
      : image;
  });

  const markdownContent = syncContextImageBlocksInMarkdown(
    doc.markdownContent ?? "",
    mergedImages.map((image) => ({
      ordinal: image.ordinal,
      label: image.label,
      description: image.description,
      stepHint: image.stepHint ?? null,
    })),
  );

  try {
    const version = await createImageAnnotationEditVersion({
      documentId: docId,
      actorUserId: session.user.id,
      markdownContent,
      imageOverrides: changedImages as Array<{
        imageId: string;
        label?: string | null;
        description?: string | null;
        stepHint?: string | null;
      }>,
      expectedActiveVersionId: parsed.data.expectedActiveVersionId ?? null,
    });

    try {
      await enqueueMaterializeDocumentVersion({
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

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to save image annotations",
      },
      { status: 500 },
    );
  }
}
