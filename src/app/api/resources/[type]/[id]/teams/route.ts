import { TeamResourceTypeSchema } from "app-types/team";
import { getSession } from "auth/server";
import { teamRepository } from "lib/db/repository";
import { getIsUserAdmin } from "lib/user/utils";
import { getTeamResourceRecord } from "lib/teams/resources";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ type: string; id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolved = await params;
  const parsedType = TeamResourceTypeSchema.safeParse(resolved.type);
  if (!parsedType.success) {
    return NextResponse.json(
      { error: "Invalid resource type" },
      { status: 400 },
    );
  }

  const resource = await getTeamResourceRecord(parsedType.data, resolved.id);
  if (!resource) {
    return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  }

  if (resource.userId !== session.user.id && !getIsUserAdmin(session.user)) {
    return NextResponse.json(
      {
        error:
          "Only the resource owner or a global admin can manage team shares",
      },
      { status: 403 },
    );
  }

  const [teams, sharedTeams] = await Promise.all([
    teamRepository.listTeamsForUser(session.user.id),
    teamRepository.listSharedTeamsForResource({
      resourceType: parsedType.data,
      resourceId: resolved.id,
    }),
  ]);

  const manageableTeams = teams.filter(
    (team) => team.role === "owner" || team.role === "admin",
  );

  return NextResponse.json({
    resource,
    manageableTeams,
    sharedTeams,
  });
}
