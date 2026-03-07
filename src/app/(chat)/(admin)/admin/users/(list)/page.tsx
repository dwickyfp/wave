import { UsersTable } from "@/components/admin/users-table";
import { requireAdminPermission } from "auth/permissions";
import { getAdminUsers } from "lib/admin/server";
import { ADMIN_USER_LIST_LIMIT } from "lib/admin/server";
import {
  buildAdminUsersQuery,
  parseAdminUsersSearchParams,
} from "lib/admin/users";
import { getSession } from "lib/auth/server";
import { redirect, unauthorized } from "next/navigation";

// Force dynamic rendering to avoid static generation issues with session
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    page?: string;
    limit?: string;
    query?: string;
    sortBy?: string;
    sortDirection?: "asc" | "desc";
  }>;
}

export default async function UserListPage({ searchParams }: PageProps) {
  // Redirect before rendering the page if the user is not an admin

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
  const searchState = parseAdminUsersSearchParams(
    params,
    ADMIN_USER_LIST_LIMIT,
  );
  const result = await getAdminUsers(buildAdminUsersQuery(searchState));

  return (
    <UsersTable
      users={result.users}
      currentUserId={session.user.id}
      total={result.total}
      page={searchState.page}
      limit={searchState.limit}
      query={searchState.query}
      baseUrl="/admin/users"
      sortBy={searchState.sortBy}
      sortDirection={searchState.sortDirection}
    />
  );
}
