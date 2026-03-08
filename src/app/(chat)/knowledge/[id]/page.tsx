import { KnowledgeDetailPage } from "@/components/knowledge/knowledge-detail-page";
import { getSession } from "auth/server";
import { knowledgeRepository, settingsRepository } from "lib/db/repository";
import { notFound } from "next/navigation";

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

  const [documents, contextxConfig] = await Promise.all([
    knowledgeRepository.selectDocumentsByGroupScope(id),
    settingsRepository.getSetting("contextx-model"),
  ]);
  const sourceGroups = await knowledgeRepository.selectGroupSources(id);

  const contextxModel = contextxConfig as {
    provider: string;
    model: string;
  } | null;

  return (
    <KnowledgeDetailPage
      group={group}
      initialDocuments={documents}
      initialSourceGroups={sourceGroups}
      userId={session.user.id}
      contextxModel={contextxModel}
    />
  );
}
