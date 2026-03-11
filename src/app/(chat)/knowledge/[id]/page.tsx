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

  const [documents, sourceGroups, settings] = await Promise.all([
    knowledgeRepository.selectDocumentsByGroupScope(id),
    knowledgeRepository.selectGroupSources(id),
    settingsRepository
      .getSettings([
        "knowledge-parse-model",
        "knowledge-context-model",
        "knowledge-image-model",
      ])
      .catch((error) => {
        console.warn(
          `[settings] Failed to load knowledge model settings for group ${id}:`,
          error,
        );
        return {};
      }),
  ]);

  const parseConfig = settings["knowledge-parse-model"] ?? null;
  const contextConfig = settings["knowledge-context-model"] ?? null;
  const imageConfig = settings["knowledge-image-model"] ?? null;

  return (
    <KnowledgeDetailPage
      group={group}
      initialDocuments={documents}
      initialSourceGroups={sourceGroups}
      userId={session.user.id}
      knowledgeModels={{
        parse:
          (parseConfig as { provider: string; model: string } | null) ?? null,
        context:
          (contextConfig as { provider: string; model: string } | null) ?? null,
        image:
          (imageConfig as { provider: string; model: string } | null) ?? null,
      }}
    />
  );
}
