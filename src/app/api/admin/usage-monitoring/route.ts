import {
  USAGE_MONITORING_LIMIT,
  getAdminUsageMonitoring,
} from "lib/admin/server";
import { parseUsageMonitoringSearchParams } from "lib/admin/usage-monitoring";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const searchState = parseUsageMonitoringSearchParams(
      request.nextUrl.searchParams,
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

    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to load usage monitoring data";
    const status = message.startsWith("Unauthorized") ? 401 : 500;

    return NextResponse.json({ message }, { status });
  }
}
