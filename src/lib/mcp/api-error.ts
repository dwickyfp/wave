const MCP_PUBLISH_MIGRATION_MESSAGE =
  "MCP publish schema is missing in the database. Run `pnpm db:migrate` or `pnpm db:push` to apply migration `0051_mcp_publish_bridge`.";

export function getMcpApiError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unexpected MCP server error";

  const normalized = message.toLowerCase();

  if (
    normalized.includes("publish_enabled") ||
    normalized.includes("publish_auth_mode") ||
    normalized.includes("publish_api_key_hash") ||
    normalized.includes("publish_api_key_preview")
  ) {
    return {
      status: 500,
      message: MCP_PUBLISH_MIGRATION_MESSAGE,
    };
  }

  if (message === "Unauthorized") {
    return { status: 403, message };
  }

  if (message === "MCP server not found") {
    return { status: 404, message };
  }

  return { status: 500, message };
}

export function getMcpApiErrorResponse(error: unknown) {
  const resolved = getMcpApiError(error);

  return Response.json(
    {
      error: resolved.message,
      message: resolved.message,
    },
    { status: resolved.status },
  );
}
