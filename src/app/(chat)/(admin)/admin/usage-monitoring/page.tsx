import {
  getAdminUsageMonitoring,
  USAGE_MONITORING_LIMIT,
} from "lib/admin/server";
import { requireAdminPermission } from "auth/permissions";
import { getSession } from "lib/auth/server";
import { redirect, unauthorized } from "next/navigation";
import {
  DatePreset,
  UsageMonitoringTable,
} from "@/components/admin/usage-monitoring-table";
import type { UsageMonitoringQuery } from "app-types/admin";

export const dynamic = "force-dynamic";

const PRESET_DAYS: Record<DatePreset, number> = {
  "7d": 7,
  "14d": 14,
  "30d": 30,
  "90d": 90,
};

function getDateRange(preset: DatePreset): { startDate: Date; endDate: Date } {
  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - PRESET_DAYS[preset]);
  startDate.setHours(0, 0, 0, 0);

  return { startDate, endDate };
}

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

  const rawPreset = params.preset ?? "7d";
  const preset: DatePreset =
    rawPreset === "7d" ||
    rawPreset === "14d" ||
    rawPreset === "30d" ||
    rawPreset === "90d"
      ? rawPreset
      : "7d";

  const page = parseInt(params.page ?? "1", 10);
  const limit = USAGE_MONITORING_LIMIT;
  const offset = (page - 1) * limit;
  const sortBy = (params.sortBy ??
    "totalTokens") as UsageMonitoringQuery["sortBy"];
  const sortDirection = (params.sortDirection ?? "desc") as "asc" | "desc";

  const { startDate, endDate } = getDateRange(preset);

  const data = await getAdminUsageMonitoring({
    startDate,
    endDate,
    limit,
    offset,
    sortBy,
    sortDirection,
    searchValue: params.query,
  });

  return (
    <UsageMonitoringTable
      data={data}
      page={page}
      limit={limit}
      query={params.query}
      sortBy={sortBy ?? "totalTokens"}
      sortDirection={sortDirection}
      preset={preset}
    />
  );
}
