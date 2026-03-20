import { TeamSchema } from "app-types/team";
import { getSession } from "auth/server";
import { canCreateTeam } from "lib/auth/permissions";
import { teamRepository } from "lib/db/repository";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teams = await teamRepository.listTeamsForUser(session.user.id);
  return NextResponse.json(teams);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await canCreateTeam())) {
    return NextResponse.json(
      { error: "Only creators and admins can create teams" },
      { status: 403 },
    );
  }

  const body = await req.json();
  const parsed = TeamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const team = await teamRepository.createTeam({
    ...parsed.data,
    ownerUserId: session.user.id,
  });

  return NextResponse.json(team, { status: 201 });
}
