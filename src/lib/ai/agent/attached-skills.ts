import type { SkillGroupSummary, SkillSummary } from "app-types/skill";
import { skillGroupRepository, skillRepository } from "lib/db/repository";

export function dedupeSkillsById(skills: SkillSummary[]) {
  const seen = new Set<string>();

  return skills.filter((skill) => {
    if (seen.has(skill.id)) {
      return false;
    }

    seen.add(skill.id);
    return true;
  });
}

export async function getAgentAttachedSkills(agentId: string): Promise<{
  directSkills: SkillSummary[];
  skillGroups: SkillGroupSummary[];
  attachedSkills: SkillSummary[];
}> {
  const [directSkills, skillGroups, groupSkills] = await Promise.all([
    skillRepository.getSkillsByAgentId(agentId),
    skillGroupRepository.getGroupsByAgentId(agentId),
    skillGroupRepository.getSkillsByAgentGroupId(agentId),
  ]);

  return {
    directSkills,
    skillGroups,
    attachedSkills: dedupeSkillsById([...directSkills, ...groupSkills]),
  };
}
