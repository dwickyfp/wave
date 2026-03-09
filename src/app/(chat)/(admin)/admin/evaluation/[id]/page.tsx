import { EvaluationUserDetailPage } from "@/components/admin/evaluation-user-detail-page";
import { requireAdminPermission } from "auth/permissions";
import { getSelfLearningUserDetail } from "lib/self-learning/service";
import { notFound, unauthorized } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function AdminEvaluationUserPage({ params }: PageProps) {
  try {
    await requireAdminPermission();
  } catch (_error) {
    unauthorized();
  }

  const { id } = await params;
  const detail = await getSelfLearningUserDetail(id);

  if (!detail.user) {
    notFound();
  }

  return <EvaluationUserDetailPage userId={id} initialDetail={detail} />;
}
