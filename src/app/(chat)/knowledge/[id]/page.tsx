import { knowledgeRepository } from "lib/db/repository";
import { getSession } from "auth/server";
import { notFound } from "next/navigation";
import { KnowledgeDetailPage } from "@/components/knowledge/knowledge-detail-page";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function KnowledgeGroupDetailPage({ params }: Props) {
  const session = await getSession();
  if (!session?.user.id) notFound();

  const { id } = await params;
  const group = await knowledgeRepository.selectGroupById(id, session.user.id);
  if (!group) notFound();

  const documents = await knowledgeRepository.selectDocumentsByGroupId(id);

  return (
    <KnowledgeDetailPage
      group={group}
      initialDocuments={documents}
      userId={session.user.id}
    />
  );
}
