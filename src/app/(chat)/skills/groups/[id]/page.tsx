import { SkillGroupDetailPage } from "@/components/skill/skill-group-detail-page";
import { getSession } from "auth/server";
import { skillGroupRepository } from "lib/db/repository";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SkillGroupPage({ params }: Props) {
  const session = await getSession();
  if (!session?.user.id) notFound();

  const { id } = await params;
  const group = await skillGroupRepository.selectGroupById(id, session.user.id);
  if (!group) notFound();

  const skills = await skillGroupRepository.getSkillsByGroupId(id);

  return (
    <SkillGroupDetailPage
      group={group}
      initialSkills={skills}
      userId={session.user.id}
    />
  );
}
