import { NextRequest, NextResponse } from "next/server";
import { getSession } from "auth/server";
import { knowledgeRepository } from "lib/db/repository";
import { serverFileStorage } from "lib/file-storage";
import { enqueueIngestDocument } from "lib/knowledge/worker-client";

interface Params {
  params: Promise<{ id: string; docId: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { docId } = await params;
  const doc = await knowledgeRepository.selectDocumentById(docId);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(doc);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
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

  // Delete from storage
  if (doc.storagePath) {
    await serverFileStorage.delete(doc.storagePath).catch(() => {});
  }

  // Cascade deletes chunks too
  await knowledgeRepository.deleteDocument(docId);
  return NextResponse.json({ success: true });
}

export async function POST(_req: NextRequest, { params }: Params) {
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
  if (!doc || doc.groupId !== groupId)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Reset status to pending and re-queue
  await knowledgeRepository.updateDocumentStatus(docId, "pending");
  await enqueueIngestDocument(docId, groupId);

  return NextResponse.json({ success: true });
}
