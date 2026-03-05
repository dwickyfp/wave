import { NextRequest, NextResponse } from "next/server";
import { getSession } from "auth/server";
import { knowledgeRepository } from "lib/db/repository";
import { serverFileStorage } from "lib/file-storage";
import { enqueueIngestDocument } from "lib/knowledge/worker-client";
import { DocumentFileType } from "app-types/knowledge";

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

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Verify access to group
  const group = await knowledgeRepository.selectGroupById(id, session.user.id);
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const docs = await knowledgeRepository.selectDocumentsByGroupId(id);
  return NextResponse.json(docs);
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: groupId } = await params;

  // Verify access to group
  const group = await knowledgeRepository.selectGroupById(
    groupId,
    session.user.id,
  );
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const formData = await req.formData();

  // Handle URL source
  const sourceUrl = formData.get("sourceUrl") as string | null;
  if (sourceUrl) {
    const name =
      (formData.get("name") as string) || new URL(sourceUrl).hostname;
    const doc = await knowledgeRepository.insertDocument({
      groupId,
      userId: session.user.id,
      name,
      originalFilename: sourceUrl,
      fileType: "url",
      sourceUrl,
    });
    await enqueueIngestDocument(doc.id, groupId);
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

  const fileType = MIME_TO_TYPE[file.type] ?? "txt";

  const buffer = Buffer.from(await file.arrayBuffer());
  const uploadResult = await serverFileStorage.upload(buffer, {
    filename: `knowledge/${groupId}/${Date.now()}-${file.name}`,
    contentType: file.type || "application/octet-stream",
  });

  const doc = await knowledgeRepository.insertDocument({
    groupId,
    userId: session.user.id,
    name: (formData.get("name") as string) || file.name,
    originalFilename: file.name,
    fileType,
    fileSize: file.size,
    storagePath: uploadResult.key,
  });

  await enqueueIngestDocument(doc.id, groupId);
  return NextResponse.json(doc, { status: 201 });
}
