import { TeamMemberUpdateSchema } from "app-types/team";
import { teamRepository } from "lib/db/repository";
import {
  requireCurrentTeamOwner,
  requireManageableTargetMember,
} from "lib/teams/access";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string; userId: string }>;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, userId } = await params;

  try {
    await requireCurrentTeamOwner(id);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 403 },
    );
  }

  const targetMember = await teamRepository.getTeamMember(id, userId);
  if (!targetMember) {
    return NextResponse.json(
      { error: "Team member not found" },
      { status: 404 },
    );
  }
  if (targetMember.role === "owner") {
    return NextResponse.json(
      { error: "Owner role cannot be changed" },
      { status: 409 },
    );
  }

  const body = await req.json();
  const parsed = TeamMemberUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const member = await teamRepository.updateTeamMemberRole(
    id,
    userId,
    parsed.data.role,
  );
  return NextResponse.json(member);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, userId } = await params;

  try {
    await requireManageableTargetMember(id, userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    const status = message === "Team member not found" ? 404 : 403;
    return NextResponse.json({ error: message }, { status });
  }

  await teamRepository.removeTeamMember(id, userId);
  return NextResponse.json({ success: true });
}
