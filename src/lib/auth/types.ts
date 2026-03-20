/**
 * Type definitions for Better Auth role system
 */

import type { PERMISSION_TYPES } from "app-types/permissions";

type PermissionType = (typeof PERMISSION_TYPES)[keyof typeof PERMISSION_TYPES];

/**
 * Better Auth role object structure
 */
export interface BetterAuthRole {
  statements: {
    user?: readonly string[];
    session?: readonly string[];
    workflow?: readonly PermissionType[];
    agent?: readonly PermissionType[];
    mcp?: readonly PermissionType[];
    chat?: readonly PermissionType[];
    temporaryChat?: readonly PermissionType[];
    [key: string]: readonly string[] | undefined;
  };
}

/**
 * Valid role names in the system
 */
export type RoleName = "admin" | "creator" | "user";

function normalizeRoleToken(roleToken: string): string {
  // Handle OAuth roles that may be prefixed with provider name
  // (for example "google:creator").
  const lastColonIndex = roleToken.lastIndexOf(":");
  const cleanRole =
    lastColonIndex !== -1 ? roleToken.substring(lastColonIndex + 1) : roleToken;

  return cleanRole.trim().toLowerCase();
}

/**
 * Validates and cleans a role string, handling OAuth provider prefixes
 * and comma-separated role lists.
 */
export function parseRoleString(role: string | undefined | null): RoleName {
  if (!role) return "user";

  // Validate the role is one of our known roles
  const normalizedRoles = role
    .split(",")
    .map(normalizeRoleToken)
    .filter(Boolean);

  if (normalizedRoles.includes("admin")) return "admin";
  if (normalizedRoles.includes("creator")) return "creator";
  if (normalizedRoles.includes("user")) return "user";

  if (normalizedRoles.length === 0) {
    console.warn(`Invalid role detected: ${role}, defaulting to user`);
    return "user";
  }

  console.warn(`Invalid role detected: ${role}, defaulting to user`);
  return "user";
}

export function isCreatorRole(role: string | undefined | null): boolean {
  const cleanRole = parseRoleString(role);
  return cleanRole === "admin" || cleanRole === "creator";
}

/**
 * Type guard to check if an object is a BetterAuthRole
 */
export function isBetterAuthRole(obj: unknown): obj is BetterAuthRole {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "statements" in obj &&
    typeof (obj as any).statements === "object"
  );
}
