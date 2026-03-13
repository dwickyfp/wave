import { TeamResourceShareSchema } from "app-types/team";
import { getSession } from "auth/server";
import { teamRepository } from "lib/db/repository";
import { getIsUserAdmin } from "lib/user/utils";
import { requireCurrentTeamManager } from "lib/teams/access";
import { getTeamResourceRecord } from "lib/teams/resources";
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

  return NextResponse.json(team.resources);
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
  const parsed = TeamResourceShareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const resource = await getTeamResourceRecord(
    parsed.data.resourceType,
    parsed.data.resourceId,
  );
  if (!resource) {
    return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  }

  if (resource.userId !== currentUser.id && !getIsUserAdmin(currentUser)) {
    return NextResponse.json(
      {
        error:
          "Only the resource owner or a global admin can share this resource",
      },
      { status: 403 },
    );
  }

  try {
    const share = await teamRepository.addResourceShare({
      teamId: id,
      resourceType: parsed.data.resourceType,
      resourceId: parsed.data.resourceId,
      sharedByUserId: currentUser.id,
    });

    return NextResponse.json(share, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Resource is already shared to this team" },
      { status: 409 },
    );
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    await requireCurrentTeamManager(id);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 403 },
    );
  }

  const body = await req.json();
  const parsed = TeamResourceShareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await teamRepository.removeResourceShare(
    id,
    parsed.data.resourceType,
    parsed.data.resourceId,
  );
  return NextResponse.json({ success: true });
}
