import { NextRequest, NextResponse } from "next/server";
import { getSession } from "auth/server";
import { isCreatorRole } from "lib/auth/types";
import { knowledgeRepository } from "lib/db/repository";
import { hash } from "bcrypt-ts";
import { nanoid } from "nanoid";

interface Params {
  params: Promise<{ id: string }>;
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

  const { id } = await params;
  const { action } = await req.json();

  const group = await knowledgeRepository.selectGroupById(id, session.user.id);
  if (!group || group.userId !== session.user.id) {
    return NextResponse.json(
      { error: "Not found or unauthorized" },
      { status: 404 },
    );
  }

  if (action === "revoke") {
    await knowledgeRepository.setMcpApiKey(id, session.user.id, "", "");
    return NextResponse.json({ success: true });
  }

  // Generate new API key
  const rawKey = `cx_${nanoid(40)}`;
  const keyHash = await hash(rawKey, 10);
  const keyPreview = rawKey.slice(-4);

  await knowledgeRepository.setMcpApiKey(
    id,
    session.user.id,
    keyHash,
    keyPreview,
  );

  // Return plaintext key only once
  return NextResponse.json({ key: rawKey, preview: keyPreview });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isCreatorRole(session.user.role)) {
    return NextResponse.json(
      { error: "Only creators and admins can manage ContextX" },
      { status: 403 },
    );
  }

  const { id } = await params;
  const { enabled } = await req.json();

  const group = await knowledgeRepository.selectGroupById(id, session.user.id);
  if (!group || group.userId !== session.user.id) {
    return NextResponse.json(
      { error: "Not found or unauthorized" },
      { status: 404 },
    );
  }

  await knowledgeRepository.setMcpEnabled(
    id,
    session.user.id,
    Boolean(enabled),
  );
  return NextResponse.json({ success: true });
}
