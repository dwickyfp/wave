import EditAgent from "@/components/agent/edit-agent";
import {
  agentRepository,
  subAgentRepository,
  knowledgeRepository,
  skillRepository,
} from "lib/db/repository";
import { getSession } from "auth/server";
import { notFound, redirect } from "next/navigation";

export default async function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  if (!session?.user.id) {
    redirect("/sign-in");
  }

  // For new agents, pass no initial data
  if (id === "new") {
    return <EditAgent userId={session.user.id} />;
  }

  // Fetch the agent data on the server
  const [agent, subAgents, knowledgeGroups, skills] = await Promise.all([
    agentRepository.selectAgentById(id, session.user.id),
    subAgentRepository.selectSubAgentsByAgentId(id),
    knowledgeRepository.getGroupsByAgentId(id),
    skillRepository.getSkillsByAgentId(id),
  ]);

  if (!agent) {
    notFound();
  }

  if (agent.agentType === "snowflake_cortex") {
    redirect(`/agent/snowflake/${id}`);
  }

  const isOwner = agent.userId === session.user.id;
  const hasEditAccess = isOwner || agent.visibility === "public";

  return (
    <EditAgent
      key={id}
      initialAgent={{ ...agent, subAgents, knowledgeGroups, skills }}
      userId={session.user.id}
      isOwner={isOwner}
      hasEditAccess={hasEditAccess}
      isBookmarked={agent.isBookmarked || false}
    />
  );
}
