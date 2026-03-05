import { DocumentFileType } from "app-types/knowledge";
import { getSession } from "auth/server";
import { knowledgeRepository } from "lib/db/repository";
import { serverFileStorage } from "lib/file-storage";
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

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Verify access to group
  const group = await knowledgeRepository.selectGroupById(id, session.user.id);
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const docs = await knowledgeRepository.selectDocumentsByGroupScope(id);
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
    const doc = await knowledgeRepository.insertDocument({
      groupId,
      userId: session.user.id,
      name: body.name?.trim() || new URL(sourceUrl).hostname,
      originalFilename: sourceUrl,
      fileType: "url",
      sourceUrl,
    });
    await enqueueIngestDocument(doc.id, groupId);
    return NextResponse.json(doc, { status: 201 });
  }

  const formData = await req.formData();

  // Handle URL source
  const sourceUrl = (formData.get("sourceUrl") as string | null)?.trim();
  if (sourceUrl) {
    const name = ((formData.get("name") as string) || "").trim();
    const doc = await knowledgeRepository.insertDocument({
      groupId,
      userId: session.user.id,
      name: name || new URL(sourceUrl).hostname,
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
