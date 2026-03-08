"use client";

import useSWR, { mutate } from "swr";
import { fetcher } from "lib/utils";
import { SkillSummary } from "app-types/skill";

export function useSkills(filters = "mine,shared") {
  return useSWR<SkillSummary[]>(`/api/skill?filters=${filters}`, fetcher);
}

export function mutateSkills() {
  return mutate(
    (key: unknown) => typeof key === "string" && key.startsWith("/api/skill"),
  );
}
