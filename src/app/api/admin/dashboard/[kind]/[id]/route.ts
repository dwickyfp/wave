import { AdminDashboardKindSchema } from "app-types/admin-dashboard";
import { parseAdminDashboardDetailSearchParams } from "lib/admin/dashboard";
import {
  deleteAdminDashboardItem,
  getAdminDashboardDetail,
} from "lib/admin/dashboard.server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ kind: string; id: string }>;
  },
) {
  const { kind: rawKind, id } = await params;
  const kindResult = AdminDashboardKindSchema.safeParse(rawKind);

  if (!kindResult.success) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  try {
    const searchState = parseAdminDashboardDetailSearchParams(
      request.nextUrl.searchParams,
    );
    const data = await getAdminDashboardDetail(kindResult.data, id, {
      startDate: searchState.startDate,
      endDate: searchState.endDate,
    });

    if (!data) {
      return NextResponse.json({ message: "Not found" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to load admin dashboard detail";
    const status =
      message.startsWith("Unauthorized") || message === "FORBIDDEN" ? 401 : 500;

    return NextResponse.json({ message }, { status });
  }
}

export async function DELETE(
  _request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ kind: string; id: string }>;
  },
) {
  const { kind: rawKind, id } = await params;
  const kindResult = AdminDashboardKindSchema.safeParse(rawKind);

  if (!kindResult.success) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  try {
    await deleteAdminDashboardItem(kindResult.data, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to delete dashboard item";
    const status =
      message === "Not found"
        ? 404
        : message.startsWith("Unauthorized") || message === "FORBIDDEN"
          ? 401
          : 500;

    return NextResponse.json({ message }, { status });
  }
}
