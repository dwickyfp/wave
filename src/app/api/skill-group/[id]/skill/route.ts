import { skillGroupMemberSchema } from "app-types/skill";
import { getSession } from "auth/server";
import { skillGroupRepository, skillRepository } from "lib/db/repository";
import { canAssignSkillToGroupVisibility } from "lib/skill/skill-group-visibility";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string }>;
}

async function requireOwnedGroup(groupId: string, userId: string) {
  const group = await skillGroupRepository.selectGroupById(groupId, userId);
  if (!group) {
    return { error: "Skill group not found", status: 404 } as const;
  }

  if (group.userId !== userId) {
    return { error: "Unauthorized", status: 403 } as const;
  }

  return { group } as const;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const group = await skillGroupRepository.selectGroupById(id, session.user.id);
  if (!group) {
    return NextResponse.json(
      { error: "Skill group not found" },
      { status: 404 },
    );
  }

  const skills = await skillGroupRepository.getSkillsByGroupId(id);
  return NextResponse.json(skills);
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const ownedGroup = await requireOwnedGroup(id, session.user.id);
  if ("error" in ownedGroup) {
    return NextResponse.json(
      { error: ownedGroup.error },
      { status: ownedGroup.status },
    );
  }

  const body = await req.json();
  const parsed = skillGroupMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const skill = await skillRepository.selectSkillById(
    parsed.data.skillId,
    session.user.id,
  );
  if (!skill) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }

  const isCompatible = canAssignSkillToGroupVisibility({
    skill,
    groupVisibility: ownedGroup.group.visibility,
  });
  if (!isCompatible) {
    return NextResponse.json(
      {
        error:
          "Read-only or public skill groups can only include read-only or public skills.",
      },
      { status: 409 },
    );
  }

  await skillGroupRepository.addSkillToGroup(id, parsed.data.skillId);
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const ownedGroup = await requireOwnedGroup(id, session.user.id);
  if ("error" in ownedGroup) {
    return NextResponse.json(
      { error: ownedGroup.error },
      { status: ownedGroup.status },
    );
  }

  const body = await req.json();
  const parsed = skillGroupMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await skillGroupRepository.removeSkillFromGroup(id, parsed.data.skillId);
  return NextResponse.json({ success: true });
}
