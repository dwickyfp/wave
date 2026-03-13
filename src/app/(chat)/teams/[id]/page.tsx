import { TeamDetailPage } from "@/components/teams/team-detail-page";
import { getSession } from "auth/server";
import { teamRepository } from "lib/db/repository";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const session = await getSession();
  if (!session?.user?.id) {
    redirect("/sign-in");
  }

  const { id } = await params;
  const team = await teamRepository.getTeamById(id, session.user.id);
  if (!team) {
    notFound();
  }

  return <TeamDetailPage initialTeam={team} currentUserId={session.user.id} />;
}
