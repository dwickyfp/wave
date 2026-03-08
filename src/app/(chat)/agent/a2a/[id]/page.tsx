import A2AAgentForm from "@/components/agent/a2a-agent-form";
import { getSession } from "auth/server";
import { toSafeA2AConfig } from "lib/a2a/client";
import { agentRepository, a2aAgentRepository } from "lib/db/repository";
import { notFound, redirect } from "next/navigation";

export default async function A2AAgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  if (!session?.user.id) {
    redirect("/sign-in");
  }

  if (id === "new") {
    return <A2AAgentForm userId={session.user.id} />;
  }

  const agent = await agentRepository.selectAgentById(id, session.user.id);
  if (!agent || agent.agentType !== "a2a_remote") {
    notFound();
  }

  const config = await a2aAgentRepository.selectA2AConfigByAgentId(id);
  if (!config) {
    notFound();
  }

  const isOwner = agent.userId === session.user.id;
  const hasEditAccess = isOwner || agent.visibility === "public";

  return (
    <A2AAgentForm
      key={id}
      initialAgent={agent}
      initialConfig={toSafeA2AConfig(config)}
      userId={session.user.id}
      isOwner={isOwner}
      hasEditAccess={hasEditAccess}
    />
  );
}
