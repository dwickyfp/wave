import { SkillList } from "@/components/skill/skill-list";
import { getSession } from "auth/server";
import { skillRepository } from "lib/db/repository";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const session = await getSession();
  if (!session?.user.id) notFound();

  const skills = await skillRepository.selectSkills(session.user.id, [
    "mine",
    "shared",
  ]);
  const mine = skills.filter((skill) => skill.userId === session.user.id);
  const shared = skills.filter((skill) => skill.userId !== session.user.id);

  return (
    <SkillList
      initialMine={mine}
      initialShared={shared}
      userId={session.user.id}
    />
  );
}
