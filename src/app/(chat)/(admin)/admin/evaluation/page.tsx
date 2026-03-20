import { EvaluationSystemPage } from "@/components/admin/evaluation-system-page";
import { requireAdminPermission } from "auth/permissions";
import {
  getSelfLearningOverview,
  listSelfLearningUsers,
} from "lib/self-learning/service";
import { parseSelfLearningUsersSearchParams } from "lib/self-learning/admin";
import { unauthorized } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    page?: string;
    query?: string;
  }>;
}

export default async function AdminEvaluationPage({ searchParams }: PageProps) {
  try {
    await requireAdminPermission();
  } catch (_error) {
    unauthorized();
  }

  const params = await searchParams;
  const searchState = parseSelfLearningUsersSearchParams(params);

  const [overview, usersPage] = await Promise.all([
    getSelfLearningOverview(),
    listSelfLearningUsers(searchState),
  ]);

  return (
    <EvaluationSystemPage
      initialOverview={overview}
      initialUsersPage={usersPage}
      initialPage={searchState.page}
      initialQuery={searchState.query}
    />
  );
}
