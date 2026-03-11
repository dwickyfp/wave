import { updateSkillGroupSchema } from "app-types/skill";
import { getSession } from "auth/server";
import { skillGroupRepository } from "lib/db/repository";
import { hasIncompatibleSkillsForGroupVisibility } from "lib/skill/skill-group-visibility";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const group = await skillGroupRepository.selectGroupById(id, session.user.id);
  if (!group) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(group);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = updateSkillGroupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (parsed.data.visibility) {
    const skills = await skillGroupRepository.getSkillsByGroupId(id);
    const hasIncompatibleSkills = hasIncompatibleSkillsForGroupVisibility({
      skills,
      groupVisibility: parsed.data.visibility,
    });

    if (hasIncompatibleSkills) {
      return NextResponse.json(
        {
          error:
            "Read-only or public skill groups can only include read-only or public skills.",
        },
        { status: 409 },
      );
    }
  }

  try {
    const group = await skillGroupRepository.updateGroup(
      id,
      session.user.id,
      parsed.data,
    );
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
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await skillGroupRepository.deleteGroup(id, session.user.id);
  return NextResponse.json({ success: true });
}
