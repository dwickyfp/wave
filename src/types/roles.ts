export const USER_ROLES = {
  ADMIN: "admin",
  CREATOR: "creator",
  USER: "user",
} as const;
export type UserRoleNames = (typeof USER_ROLES)[keyof typeof USER_ROLES];

// Default user role is "creator" which matches the current user capabilities

export const DEFAULT_USER_ROLE: UserRoleNames =
  process.env.DEFAULT_USER_ROLE &&
  Object.values(USER_ROLES).includes(
    process.env.DEFAULT_USER_ROLE as UserRoleNames,
  )
    ? (process.env.DEFAULT_USER_ROLE as UserRoleNames)
    : USER_ROLES.CREATOR;

export type UserRolesInfo = Record<
  UserRoleNames,
  {
    label: string;
    description: string;
  }
>;

export const userRolesInfo: UserRolesInfo = {
  admin: {
    label: "Admin",
    description: "Admin user can manage the app",
  },
  creator: {
    label: "Creator",
    description:
      "Default role for users who can create agents, workflows and add MCPs",
  },
  user: {
    label: "User",
    description: "Basic user role",
  },
};
