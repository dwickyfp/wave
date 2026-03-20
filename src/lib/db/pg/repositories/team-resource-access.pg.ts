import { TeamResourceType } from "app-types/team";
import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { TeamMemberTable, TeamResourceShareTable } from "../schema.pg";

export function buildTeamShareExists(
  resourceType: TeamResourceType,
  resourceIdColumn: AnyPgColumn,
  userId: string,
) {
  return sql<boolean>`exists (
    select 1
    from ${TeamResourceShareTable} trs
    inner join ${TeamMemberTable} tm on tm.team_id = trs.team_id
    where trs.resource_type = ${resourceType}
      and trs.resource_id = ${resourceIdColumn}
      and tm.user_id = ${userId}
  )`;
}
