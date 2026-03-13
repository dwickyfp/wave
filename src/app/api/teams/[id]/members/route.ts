import { TeamMemberInviteSchema } from "app-types/team";
import { teamRepository, userRepository } from "lib/db/repository";
import { requireCurrentTeamManager } from "lib/teams/access";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;

  let currentUser;
  try {
    ({ currentUser } = await requireCurrentTeamManager(id));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 403 },
    );
  }

  const body = await req.json();
  const parsed = TeamMemberInviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const user = await userRepository.getUserByEmail(
    parsed.data.email.toLowerCase(),
  );
  if (!user) {
    return NextResponse.json(
      { error: "User account not found" },
      { status: 404 },
    );
  }

  const existing = await teamRepository.getTeamMember(id, user.id);
  if (existing) {
    return NextResponse.json(
      { error: "User is already a team member" },
      { status: 409 },
    );
  }

  const member = await teamRepository.addTeamMember({
    teamId: id,
    userId: user.id,
    role: parsed.data.role,
    addedByUserId: currentUser.id,
  });

  return NextResponse.json(member, { status: 201 });
}
