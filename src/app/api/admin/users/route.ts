import { ADMIN_USER_LIST_LIMIT, getAdminUsers } from "lib/admin/server";
import {
  buildAdminUsersQuery,
  parseAdminUsersSearchParams,
} from "lib/admin/users";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const searchState = parseAdminUsersSearchParams(
      request.nextUrl.searchParams,
      ADMIN_USER_LIST_LIMIT,
    );
    const data = await getAdminUsers(buildAdminUsersQuery(searchState));

    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load admin users";
    const status = message.startsWith("Unauthorized") ? 401 : 500;

    return NextResponse.json({ message }, { status });
  }
}
