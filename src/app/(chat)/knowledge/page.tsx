import { knowledgeRepository } from "lib/db/repository";
import { getSession } from "auth/server";
import { notFound } from "next/navigation";
import { KnowledgeList } from "@/components/knowledge/knowledge-list";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const session = await getSession();
  if (!session?.user.id) notFound();

  const groups = await knowledgeRepository.selectGroups(session.user.id, [
    "mine",
    "shared",
  ]);
  const mine = groups.filter((g) => g.userId === session.user.id);
  const shared = groups.filter((g) => g.userId !== session.user.id);

  return (
    <KnowledgeList
      initialMine={mine}
      initialShared={shared}
      userId={session.user.id}
    />
  );
}
