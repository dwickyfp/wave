import { updateKnowledgeGroupSchema } from "app-types/knowledge";
import { getSession } from "auth/server";
import { knowledgeRepository } from "lib/db/repository";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const group = await knowledgeRepository.selectGroupById(id, session.user.id);
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(group);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const parsed = updateKnowledgeGroupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const { sourceGroupIds, ...groupData } = parsed.data;
    const group = await knowledgeRepository.updateGroup(
      id,
      session.user.id,
      groupData,
    );

    if (Array.isArray(sourceGroupIds)) {
      await knowledgeRepository.setGroupSources(
        id,
        session.user.id,
        sourceGroupIds,
      );
    }

    return NextResponse.json(group);
  } catch {
    return NextResponse.json(
      { error: "Not found or unauthorized" },
      { status: 404 },
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await knowledgeRepository.deleteGroup(id, session.user.id);
  return NextResponse.json({ success: true });
}
