import type { SkillSummary, SkillVisibility } from "app-types/skill";

export function isSharedSkillVisibility(visibility: SkillVisibility) {
  return visibility === "public" || visibility === "readonly";
}

export function canAssignSkillToGroupVisibility(options: {
  skill: Pick<SkillSummary, "visibility">;
  groupVisibility: SkillVisibility;
}) {
  if (options.groupVisibility === "private") {
    return true;
  }

  return isSharedSkillVisibility(options.skill.visibility);
}

export function hasIncompatibleSkillsForGroupVisibility(options: {
  skills: Array<Pick<SkillSummary, "visibility">>;
  groupVisibility: SkillVisibility;
}) {
  if (options.groupVisibility === "private") {
    return false;
  }

  return options.skills.some(
    (skill) => !isSharedSkillVisibility(skill.visibility),
  );
}
