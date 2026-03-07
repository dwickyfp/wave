import { UsageMonitoringTable } from "@/components/admin/usage-monitoring-table";
import { requireAdminPermission } from "auth/permissions";
import {
  USAGE_MONITORING_LIMIT,
  getAdminUsageMonitoring,
} from "lib/admin/server";
import { parseUsageMonitoringSearchParams } from "lib/admin/usage-monitoring";
import { getSession } from "lib/auth/server";
import { redirect, unauthorized } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    page?: string;
    query?: string;
    sortBy?: string;
    sortDirection?: "asc" | "desc";
    preset?: string;
  }>;
}

export default async function UsageMonitoringPage({ searchParams }: PageProps) {
  try {
    await requireAdminPermission();
  } catch (_error) {
    unauthorized();
  }

  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const params = await searchParams;
  const searchState = parseUsageMonitoringSearchParams(
    params,
    USAGE_MONITORING_LIMIT,
  );

  const data = await getAdminUsageMonitoring({
    startDate: searchState.startDate,
    endDate: searchState.endDate,
    limit: searchState.limit,
    offset: searchState.offset,
    sortBy: searchState.sortBy,
    sortDirection: searchState.sortDirection,
    searchValue: searchState.query,
  });

  return (
    <UsageMonitoringTable
      data={data}
      page={searchState.page}
      limit={searchState.limit}
      query={searchState.query}
      sortBy={searchState.sortBy}
      sortDirection={searchState.sortDirection}
      preset={searchState.preset}
    />
  );
}
