import { ResourceDashboardPage } from "@/components/admin/resource-dashboard-page";
import { AdminDashboardKindSchema } from "app-types/admin-dashboard";
import {
  ADMIN_DASHBOARD_LIMIT,
  parseAdminDashboardSearchParams,
} from "lib/admin/dashboard";
import { getAdminDashboardList } from "lib/admin/dashboard.server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{
    page?: string;
    query?: string;
    sortBy?: string;
    sortDirection?: "asc" | "desc";
    preset?: string;
    startDate?: string;
    endDate?: string;
  }>;
}

export default async function AdminDashboardListPage({
  params,
  searchParams,
}: PageProps) {
  const { kind: rawKind } = await params;
  const kindResult = AdminDashboardKindSchema.safeParse(rawKind);
  if (!kindResult.success) {
    notFound();
  }

  const resolvedSearchParams = await searchParams;
  const searchState = parseAdminDashboardSearchParams(
    resolvedSearchParams,
    ADMIN_DASHBOARD_LIMIT,
  );
  const data = await getAdminDashboardList(kindResult.data, {
    startDate: searchState.startDate,
    endDate: searchState.endDate,
    limit: searchState.limit,
    offset: searchState.offset,
    sortBy: searchState.sortBy,
    sortDirection: searchState.sortDirection,
    searchValue: searchState.query,
  });

  return (
    <ResourceDashboardPage
      kind={kindResult.data}
      data={data}
      page={searchState.page}
      limit={searchState.limit}
      query={searchState.query}
      sortBy={searchState.sortBy}
      sortDirection={searchState.sortDirection}
      preset={searchState.preset}
      startDate={searchState.startDateInput}
      endDate={searchState.endDateInput}
    />
  );
}
