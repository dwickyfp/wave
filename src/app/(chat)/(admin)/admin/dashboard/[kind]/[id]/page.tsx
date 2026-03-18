import { ResourceDashboardDetailPage } from "@/components/admin/resource-dashboard-detail-page";
import { AdminDashboardKindSchema } from "app-types/admin-dashboard";
import { parseAdminDashboardDetailSearchParams } from "lib/admin/dashboard";
import { getAdminDashboardDetail } from "lib/admin/dashboard.server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{
    preset?: string;
    startDate?: string;
    endDate?: string;
  }>;
}

export default async function AdminDashboardDetailRoutePage({
  params,
  searchParams,
}: PageProps) {
  const { kind: rawKind, id } = await params;
  const kindResult = AdminDashboardKindSchema.safeParse(rawKind);
  if (!kindResult.success) {
    notFound();
  }

  const resolvedSearchParams = await searchParams;
  const searchState =
    parseAdminDashboardDetailSearchParams(resolvedSearchParams);
  const data = await getAdminDashboardDetail(kindResult.data, id, {
    startDate: searchState.startDate,
    endDate: searchState.endDate,
  });
  if (!data) {
    notFound();
  }
  const resolvedData = data;

  return (
    <ResourceDashboardDetailPage
      kind={kindResult.data}
      id={id}
      data={resolvedData}
      preset={searchState.preset}
      startDate={searchState.startDateInput}
      endDate={searchState.endDateInput}
    />
  );
}
