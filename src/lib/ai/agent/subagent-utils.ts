/**
 * Pure utility functions for subagent tool name encoding/decoding.
 * This file is intentionally free of any server-only imports so it can be
 * used safely in Client Components.
 */

/**
 * Sanitize a subagent name to be safe for use inside a tool name.
 * Output: lowercase alphanumeric + underscores, max 24 chars.
 */
export function sanitizeSubAgentNamePart(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
}

/**
 * Build the tool name for a subagent.
 * Format: subagent_{sanitizedName}_{first8charsOfId}
 * The UI can parse the name back from this format.
 */
export function buildSubAgentToolName(subagent: {
  id: string;
  name: string;
}): string {
  const sanitized = sanitizeSubAgentNamePart(subagent.name) || "agent";
  const shortId = subagent.id.replace(/-/g, "").slice(0, 8);
  return `subagent_${sanitized}_${shortId}`;
}

/**
 * Extract the human-readable subagent name from a tool name.
 * Returns undefined if the tool name is not a subagent tool.
 */
export function extractSubAgentNameFromToolName(
  toolName: string | undefined | null,
): string | undefined {
  if (!toolName || !toolName.startsWith("subagent_")) return undefined;
  const withoutPrefix = toolName.slice("subagent_".length);
  // Strip the trailing _XXXXXXXX (underscore + 8 hex chars)
  const withoutId = withoutPrefix.replace(/_[0-9a-f]{8}$/, "");
  if (!withoutId) return "Subagent";
  return withoutId
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Returns true if the given tool name belongs to a subagent tool.
 */
export function isSubAgentToolName(
  toolName: string | undefined | null,
): boolean {
  return !!toolName && toolName.startsWith("subagent_");
}
