import {
  SharedTeamSummary,
  TeamAccessSource,
  TeamResourceType,
} from "app-types/team";
import { pgTeamRepository } from "./team-repository.pg";

export type TeamAwareResource = {
  id: string;
  userId: string;
  visibility?: string;
  sharedTeams?: SharedTeamSummary[];
  accessSource?: TeamAccessSource;
};

export async function attachSharedTeamsToResources<T extends TeamAwareResource>(
  items: T[],
  resourceType: TeamResourceType,
  currentUserId: string,
): Promise<T[]> {
  return await Promise.all(
    items.map(async (item) => {
      const sharedTeams = await pgTeamRepository.listSharedTeamsForResource({
        resourceType,
        resourceId: item.id,
      });

      const accessSource: TeamAccessSource =
        item.userId === currentUserId
          ? "owner"
          : item.visibility === "public" || item.visibility === "readonly"
            ? "public"
            : "team";

      return {
        ...item,
        sharedTeams,
        accessSource,
      };
    }),
  );
}
