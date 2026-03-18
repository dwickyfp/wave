import { AdminDashboardKindSchema } from "app-types/admin-dashboard";
import {
  ADMIN_DASHBOARD_LIMIT,
  parseAdminDashboardSearchParams,
} from "lib/admin/dashboard";
import { getAdminDashboardList } from "lib/admin/dashboard.server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind: rawKind } = await params;
  const kindResult = AdminDashboardKindSchema.safeParse(rawKind);

  if (!kindResult.success) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  try {
    const searchState = parseAdminDashboardSearchParams(
      request.nextUrl.searchParams,
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

    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to load admin dashboard data";
    const status =
      message.startsWith("Unauthorized") || message === "FORBIDDEN" ? 401 : 500;

    return NextResponse.json({ message }, { status });
  }
}
