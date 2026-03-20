"use client";

import {
  SharedTeamSummary,
  TeamSummary,
  TeamResourceType,
} from "app-types/team";
import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { fetcher } from "lib/utils";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Badge } from "ui/badge";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";

interface ResourceTeamShareDialogProps {
  resourceType: TeamResourceType;
  resourceId: string;
  resourceName: string;
}

type ResourceTeamsResponse = {
  manageableTeams: TeamSummary[];
  sharedTeams: SharedTeamSummary[];
};

const RESOURCE_KEYS: Record<TeamResourceType, string[]> = {
  agent: ["/api/agent?filters=mine,shared", "/api/agent?filters=all&limit=50"],
  mcp: ["/api/mcp/list"],
  skill: ["/api/skill?filters=mine,shared"],
};

export function ResourceTeamShareDialog({
  resourceType,
  resourceId,
  resourceName,
}: ResourceTeamShareDialogProps) {
  const [open, setOpen] = useState(false);
  const [loadingTeamId, setLoadingTeamId] = useState<string | null>(null);
  const { mutate: mutateCache } = useSWRConfig();

  const key = `/api/resources/${resourceType}/${resourceId}/teams`;
  const { data, mutate, isLoading } = useSWR<ResourceTeamsResponse>(
    open ? key : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  const sharedTeamIds = useMemo(
    () => new Set((data?.sharedTeams ?? []).map((team) => team.id)),
    [data?.sharedTeams],
  );

  const toggleShare = async (team: TeamSummary) => {
    const isShared = sharedTeamIds.has(team.id);
    setLoadingTeamId(team.id);

    try {
      const response = await fetch(`/api/teams/${team.id}/resources`, {
        method: isShared ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceType, resourceId }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update team sharing");
      }

      await mutate();
      await Promise.all(
        RESOURCE_KEYS[resourceType].map((cacheKey) => mutateCache(cacheKey)),
      );
      toast.success(
        isShared
          ? `Removed from ${team.name}`
          : `Shared ${resourceName} to ${team.name}`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update team sharing",
      );
    } finally {
      setLoadingTeamId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground hover:text-foreground"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <Users className="size-4" />
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share to teams</DialogTitle>
          <DialogDescription>
            Manage which teams can access {resourceName}.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : !data?.manageableTeams.length ? (
          <p className="text-sm text-muted-foreground">
            You do not manage any teams yet.
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-3 pr-1">
            {data.manageableTeams.map((team) => {
              const isShared = sharedTeamIds.has(team.id);
              return (
                <div
                  key={team.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">{team.name}</p>
                      <Badge variant="outline" className="capitalize">
                        {team.role}
                      </Badge>
                    </div>
                    {team.description ? (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                        {team.description}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant={isShared ? "secondary" : "default"}
                    size="sm"
                    disabled={loadingTeamId === team.id}
                    onClick={() => toggleShare(team)}
                  >
                    {loadingTeamId === team.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : isShared ? (
                      "Remove"
                    ) : (
                      "Share"
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
