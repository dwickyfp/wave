import "server-only";

import { TeamMember, TeamRole } from "app-types/team";
import { getCurrentUser } from "lib/auth/permissions";
import { teamRepository } from "lib/db/repository";

function canManageTeam(memberRole: TeamRole) {
  return memberRole === "owner" || memberRole === "admin";
}

export function canManageTeamMember(
  actorRole: TeamRole,
  targetRole: TeamRole,
): boolean {
  if (targetRole === "owner") return false;
  if (actorRole === "owner") return true;
  if (actorRole === "admin") return targetRole === "member";
  return false;
}

export async function requireCurrentTeamMember(teamId: string) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error("Unauthorized");
  }

  const member = await teamRepository.getTeamMember(teamId, currentUser.id);
  if (!member) {
    throw new Error("Unauthorized");
  }

  return { currentUser, member };
}

export async function requireCurrentTeamManager(teamId: string) {
  const { currentUser, member } = await requireCurrentTeamMember(teamId);
  if (!canManageTeam(member.role)) {
    throw new Error("Unauthorized");
  }

  return { currentUser, member };
}

export async function requireCurrentTeamOwner(teamId: string) {
  const { currentUser, member } = await requireCurrentTeamMember(teamId);
  if (member.role !== "owner") {
    throw new Error("Unauthorized");
  }

  return { currentUser, member };
}

export async function requireManageableTargetMember(
  teamId: string,
  targetUserId: string,
): Promise<{
  currentUser: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
  member: TeamMember;
  targetMember: TeamMember;
}> {
  const { currentUser, member } = await requireCurrentTeamMember(teamId);
  const targetMember = await teamRepository.getTeamMember(teamId, targetUserId);

  if (!targetMember) {
    throw new Error("Team member not found");
  }

  if (!canManageTeamMember(member.role, targetMember.role)) {
    throw new Error("Unauthorized");
  }

  return { currentUser, member, targetMember };
}
