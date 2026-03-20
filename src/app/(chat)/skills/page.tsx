import { SkillList } from "@/components/skill/skill-list";
import { getSession } from "auth/server";
import { skillGroupRepository, skillRepository } from "lib/db/repository";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const session = await getSession();
  if (!session?.user.id) notFound();

  const [skills, groups] = await Promise.all([
    skillRepository.selectSkills(session.user.id, ["mine", "shared"]),
    skillGroupRepository.selectGroups(session.user.id, ["mine", "shared"]),
  ]);
  const mine = skills.filter((skill) => skill.userId === session.user.id);
  const shared = skills.filter((skill) => skill.userId !== session.user.id);
  const mineGroups = groups.filter((group) => group.userId === session.user.id);
  const sharedGroups = groups.filter(
    (group) => group.userId !== session.user.id,
  );

  return (
    <SkillList
      initialMine={mine}
      initialShared={shared}
      initialMineGroups={mineGroups}
      initialSharedGroups={sharedGroups}
      userId={session.user.id}
    />
  );
}
