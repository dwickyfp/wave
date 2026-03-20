"use client";

import {
  refreshMcpClientAction,
  removeMcpClientAction,
  shareMcpServerAction,
} from "@/app/api/mcp/actions";
import { appStore } from "@/app/store";
import type { MCPServerInfo } from "app-types/mcp";
import type { BasicUser } from "app-types/user";
import {
  FlaskConical,
  Loader2,
  RefreshCw,
  Settings2,
  ShieldAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { memo, useCallback, useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Card } from "ui/card";
import { Button } from "ui/button";
import { Badge } from "ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { handleErrorWithToast } from "ui/shared-toast";
import { ShareableActions, type Visibility } from "./shareable-actions";
import { redriectMcpOauth } from "lib/ai/mcp/oauth-redirect";
import { canChangeVisibilityMCP } from "lib/auth/client-permissions";
import { safe } from "ts-safe";

const STATUS_STYLES: Record<string, string> = {
  connected: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  disconnected: "bg-muted text-muted-foreground border-border",
  loading: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  authorizing: "bg-blue-500/10 text-blue-600 border-blue-500/20",
};

export const MCPCard = memo(function MCPCard({
  id,
  config,
  error,
  status,
  name,
  toolInfo,
  visibility,
  enabled,
  userId,
  user,
  userName,
  userAvatar,
  publishEnabled,
  sharedTeams,
}: MCPServerInfo & { user: BasicUser }) {
  const router = useRouter();
  const appStoreMutate = appStore((state) => state.mutate);
  const { mutate } = useSWRConfig();
  const [isProcessing, setIsProcessing] = useState(false);
  const [visibilityChangeLoading, setVisibilityChangeLoading] = useState(false);

  const isOwner = userId === user?.id;
  const canManage = isOwner || user?.role === "admin";
  const canChangeVisibility = useMemo(
    () => canChangeVisibilityMCP(user?.role),
    [user?.role],
  );
  const isLoading = isProcessing || status === "loading";
  const needsAuthorization = status === "authorizing";
  const visibleTeamNames = (sharedTeams ?? []).slice(0, 2);
  const hiddenTeamCount = (sharedTeams?.length ?? 0) - visibleTeamNames.length;

  const errorMessage = useMemo(() => {
    if (!error) return null;
    if (typeof error === "string") return error;
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return "Unknown MCP error";
    }
  }, [error]);

  const pipeProcessing = useCallback(
    async (action: () => Promise<unknown>) => {
      safe(() => setIsProcessing(true))
        .map(action)
        .ifOk(() => mutate("/api/mcp/list"))
        .ifFail(handleErrorWithToast)
        .watch(() => setIsProcessing(false));
    },
    [mutate],
  );

  const handleRefresh = useCallback(async () => {
    await pipeProcessing(() => refreshMcpClientAction(id));
  }, [id, pipeProcessing]);

  const handleDelete = useCallback(async () => {
    await pipeProcessing(() => removeMcpClientAction(id));
  }, [id, pipeProcessing]);

  const handleAuthorize = useCallback(async () => {
    try {
      await redriectMcpOauth(id);
      mutate("/api/mcp/list");
      toast.success("MCP authorization complete");
    } catch (authorizeError) {
      handleErrorWithToast(
        authorizeError instanceof Error
          ? authorizeError
          : new Error("Failed to authorize MCP server"),
      );
    }
  }, [id, mutate]);

  const handleVisibilityChange = useCallback(
    async (newVisibility: Visibility) => {
      const mappedVisibility =
        newVisibility === "public" ? "public" : "private";

      safe(() => setVisibilityChangeLoading(true))
        .map(() => shareMcpServerAction(id, mappedVisibility))
        .ifOk(() => mutate("/api/mcp/list"))
        .ifFail(handleErrorWithToast)
        .watch(() => setVisibilityChangeLoading(false));
    },
    [id, mutate],
  );

  return (
    <div data-testid="mcp-card">
      <Card
        data-testid="mcp-server-card"
        data-featured={visibility === "public" ? "true" : "false"}
        className="cursor-pointer rounded-2xl border bg-card transition-colors hover:border-foreground/20"
        onClick={() => router.push(`/mcp/${encodeURIComponent(id)}`)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            router.push(`/mcp/${encodeURIComponent(id)}`);
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-lg font-semibold">{name}</h3>
                <Badge
                  variant="outline"
                  className={
                    STATUS_STYLES[status] || STATUS_STYLES.disconnected
                  }
                >
                  {status}
                </Badge>
                <Badge variant="secondary">{toolInfo.length} tools</Badge>
                {visibility === "public" ? (
                  <Badge variant="secondary">Featured</Badge>
                ) : null}
                {canManage && publishEnabled ? (
                  <Badge variant="secondary">Published</Badge>
                ) : null}
              </div>

              <p className="text-sm text-muted-foreground">
                {needsAuthorization
                  ? "Owner authorization is required before the tools are ready."
                  : errorMessage
                    ? "This server has a connection issue. Open details for the current error and publish state."
                    : "Open details to review configuration, tools, and publish settings."}
              </p>

              {visibleTeamNames.length ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {visibleTeamNames.map((team) => (
                    <Badge key={team.id} variant="outline">
                      {team.name}
                    </Badge>
                  ))}
                  {hiddenTeamCount > 0 ? (
                    <Badge variant="outline">+{hiddenTeamCount} teams</Badge>
                  ) : null}
                </div>
              ) : null}

              {!isOwner && userName ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Avatar className="size-5 ring">
                    <AvatarImage src={userAvatar || undefined} />
                    <AvatarFallback>
                      {userName[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span>{userName}</span>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {needsAuthorization && canManage && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleAuthorize();
                  }}
                >
                  <ShieldAlert className="size-4" />
                  Authorize
                </Button>
              )}

              {canManage && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    appStoreMutate({
                      mcpCustomizationPopup: {
                        id,
                        name,
                        config,
                        status,
                        toolInfo,
                        error,
                        visibility,
                        enabled,
                        userId,
                        publishEnabled,
                      },
                    });
                  }}
                >
                  <Settings2 className="size-4" />
                  Customize
                </Button>
              )}

              {canManage && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    router.push(`/mcp/test/${encodeURIComponent(id)}`);
                  }}
                >
                  <FlaskConical className="size-4" />
                  Tool Test
                </Button>
              )}

              {canManage && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleRefresh();
                  }}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  Refresh
                </Button>
              )}

              <ShareableActions
                type="mcp"
                visibility={visibility === "public" ? "public" : "private"}
                isOwner={canManage}
                canChangeVisibility={canChangeVisibility}
                editHref={
                  canManage
                    ? `/mcp/modify/${encodeURIComponent(id)}`
                    : undefined
                }
                onVisibilityChange={
                  canManage && canChangeVisibility
                    ? handleVisibilityChange
                    : undefined
                }
                onDelete={canManage ? handleDelete : undefined}
                isVisibilityChangeLoading={visibilityChangeLoading}
                isDeleteLoading={isProcessing}
                disabled={isLoading}
                renderActions={() => null}
                editTestId="edit-mcp-button"
                deleteTestId="delete-mcp-button"
              />
            </div>
          </div>

          {errorMessage ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {errorMessage}
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
});
