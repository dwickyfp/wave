import type { User } from "./user";

export interface AdminUsersQuery {
  searchValue?: string;
  searchField?: "name" | "email";
  searchOperator?: "contains" | "starts_with" | "ends_with";
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  filterField?: string;
  filterValue?: string | number | boolean;
  filterOperator?: "lt" | "eq" | "ne" | "lte" | "gt" | "gte" | "contains";
}

// Better Auth's UserWithRole type - minimal definition for list view
export type AdminUserListItem = Omit<
  User,
  | "password"
  | "preferences"
  | "image"
  | "role"
  | "banned"
  | "banReason"
  | "banExpires"
> & {
  image?: string | null;
  role?: string | null;
  banned?: boolean | null;
  banReason?: string | null;
  banExpires?: Date | null;
};

export interface AdminUsersPaginated {
  users: AdminUserListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminUpdateUserDetailsData {
  userId: string;
  name?: string;
  email?: string;
  image?: string;
}

export interface UsageMonitoringQuery {
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
  sortBy?: "totalTokens" | "messageCount" | "threadCount" | "name" | "email";
  sortDirection?: "asc" | "desc";
  searchValue?: string;
}

export interface UserUsageStat {
  userId: string;
  name: string;
  email: string;
  image?: string | null;
  role?: string | null;
  threadCount: number;
  messageCount: number;
  totalTokens: number;
  topModel: string | null;
}

export interface ModelUsageStat {
  model: string;
  totalTokens: number;
  messageCount: number;
}

export interface UsageMonitoringData {
  users: UserUsageStat[];
  total: number;
  limit: number;
  offset: number;
  totalTokensSum: number;
  totalMessagesSum: number;
  totalThreadsSum: number;
  activeUsersCount: number;
  modelDistribution: ModelUsageStat[];
}

// Admin only repository methods
export type AdminRepository = {
  // User queries
  getUsers: (query?: AdminUsersQuery) => Promise<AdminUsersPaginated>;
  getUsersUsage: (query?: UsageMonitoringQuery) => Promise<UsageMonitoringData>;
};
