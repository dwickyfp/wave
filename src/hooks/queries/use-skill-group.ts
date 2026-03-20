"use client";

import useSWR, { mutate } from "swr";
import { fetcher } from "lib/utils";
import { SkillGroupSummary } from "app-types/skill";

export function useSkillGroups(filters = "mine,shared") {
  return useSWR<SkillGroupSummary[]>(
    `/api/skill-group?filters=${filters}`,
    fetcher,
  );
}

export function mutateSkillGroups() {
  return mutate(
    (key: unknown) =>
      typeof key === "string" && key.startsWith("/api/skill-group"),
  );
}
