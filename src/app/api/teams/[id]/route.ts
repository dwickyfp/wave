import { UpdateTeamSchema } from "app-types/team";
import { getSession } from "auth/server";
import { teamRepository } from "lib/db/repository";
import { requireCurrentTeamOwner } from "lib/teams/access";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const team = await teamRepository.getTeamById(id, session.user.id);
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  return NextResponse.json(team);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    await requireCurrentTeamOwner(id);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 403 },
    );
  }

  const body = await req.json();
  const parsed = UpdateTeamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const team = await teamRepository.updateTeam(id, parsed.data);
  return NextResponse.json(team);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    await requireCurrentTeamOwner(id);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 403 },
    );
  }

  await teamRepository.deleteTeam(id);
  return NextResponse.json({ success: true });
}
