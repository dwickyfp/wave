import { updateSkillSchema } from "app-types/skill";
import { getSession } from "auth/server";
import { skillRepository } from "lib/db/repository";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const skill = await skillRepository.selectSkillById(id, session.user.id);
  if (!skill) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(skill);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const parsed = updateSkillSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const skill = await skillRepository.updateSkill(
      id,
      session.user.id,
      parsed.data,
    );
    return NextResponse.json(skill);
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
  await skillRepository.deleteSkill(id, session.user.id);
  return NextResponse.json({ success: true });
}
