import SnowflakeAgentForm from "@/components/agent/snowflake-agent-form";
import { agentRepository, snowflakeAgentRepository } from "lib/db/repository";
import { getSession } from "auth/server";
import { notFound, redirect } from "next/navigation";

export default async function SnowflakeAgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  if (!session?.user.id) {
    redirect("/sign-in");
  }

  // New Snowflake agent creation
  if (id === "new") {
    return <SnowflakeAgentForm userId={session.user.id} />;
  }

  // Edit existing Snowflake agent
  const agent = await agentRepository.selectAgentById(id, session.user.id);

  if (!agent || (agent as any).agentType !== "snowflake_cortex") {
    notFound();
  }

  const config =
    await snowflakeAgentRepository.selectSnowflakeConfigByAgentId(id);

  const isOwner = agent.userId === session.user.id;
  const hasEditAccess = isOwner || agent.visibility === "public";

  return (
    <SnowflakeAgentForm
      key={id}
      initialAgent={agent}
      initialConfig={config ?? undefined}
      userId={session.user.id}
      isOwner={isOwner}
      hasEditAccess={hasEditAccess}
    />
  );
}
