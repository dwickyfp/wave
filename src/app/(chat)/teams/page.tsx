import { TeamsPage } from "@/components/teams/teams-page";
import { getSession } from "auth/server";
import { teamRepository } from "lib/db/repository";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getSession();
  if (!session?.user?.id) {
    redirect("/sign-in");
  }

  const teams = await teamRepository.listTeamsForUser(session.user.id);
  return <TeamsPage initialTeams={teams} userRole={session.user.role} />;
}
