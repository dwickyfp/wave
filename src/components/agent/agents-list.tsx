"use client";

import { useTranslations } from "next-intl";
import { AgentSummary, AgentUpdateSchema } from "app-types/agent";
import { Card, CardDescription, CardHeader, CardTitle } from "ui/card";
import { Button } from "ui/button";
import {
  Plus,
  ArrowUpRight,
  Snowflake,
  Waypoints,
  ChevronDown,
  Download,
  Upload,
} from "lucide-react";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { BackgroundPaths } from "ui/background-paths";
import { useBookmark } from "@/hooks/queries/use-bookmark";
import { useMutateAgents } from "@/hooks/queries/use-agents";
import { toast } from "sonner";
import useSWR from "swr";
import { fetcher } from "lib/utils";
import { Visibility } from "@/components/shareable-actions";
import { ShareableCard } from "@/components/shareable-card";
import { notify } from "lib/notify";
import { useState } from "react";
import { handleErrorWithToast } from "ui/shared-toast";
import { safe } from "ts-safe";
import { canCreateAgent } from "lib/auth/client-permissions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";

interface AgentsListProps {
  initialMyAgents: AgentSummary[];
  initialSharedAgents: AgentSummary[];
  userId: string;
  userRole?: string | null;
}

export function AgentsList({
  initialMyAgents,
  initialSharedAgents,
  userId,
  userRole,
}: AgentsListProps) {
  const t = useTranslations();
  const router = useRouter();
  const mutateAgents = useMutateAgents();
  const [deletingAgentLoading, setDeletingAgentLoading] = useState<
    string | null
  >(null);
  const [visibilityChangeLoading, setVisibilityChangeLoading] = useState<
    string | null
  >(null);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const { data: allAgents } = useSWR(
    "/api/agent?filters=mine,shared",
    fetcher,
    {
      fallbackData: [...initialMyAgents, ...initialSharedAgents],
    },
  );

  const myAgents =
    allAgents?.filter((agent: AgentSummary) => agent.userId === userId) ||
    initialMyAgents;

  const sharedAgents =
    allAgents?.filter((agent: AgentSummary) => agent.userId !== userId) ||
    initialSharedAgents;

  const { toggleBookmark: toggleBookmarkHook, isLoading: isBookmarkLoading } =
    useBookmark({
      itemType: "agent",
    });

  const toggleBookmark = async (agentId: string, isBookmarked: boolean) => {
    await toggleBookmarkHook({ id: agentId, isBookmarked });
  };

  const updateVisibility = async (agentId: string, visibility: Visibility) => {
    safe(() => setVisibilityChangeLoading(agentId))
      .map(() => AgentUpdateSchema.parse({ visibility }))
      .map(JSON.stringify)
      .map(async (body) =>
        fetcher(`/api/agent/${agentId}`, {
          method: "PUT",
          body,
        }),
      )
      .ifOk(() => {
        mutateAgents({ id: agentId, visibility });
        toast.success(t("Agent.visibilityUpdated"));
      })
      .ifFail((e) => {
        handleErrorWithToast(e);
        toast.error(t("Common.error"));
      })
      .watch(() => setVisibilityChangeLoading(null));
  };

  const deleteAgent = async (agentId: string) => {
    const ok = await notify.confirm({
      description: t("Agent.deleteConfirm"),
    });
    if (!ok) return;
    safe(() => setDeletingAgentLoading(agentId))
      .map(() =>
        fetcher(`/api/agent/${agentId}`, {
          method: "DELETE",
        }),
      )
      .ifOk(() => {
        mutateAgents({ id: agentId }, true);
        toast.success(t("Agent.deleted"));
      })
      .ifFail((e) => {
        handleErrorWithToast(e);
        toast.error(t("Common.error"));
      })
      .watch(() => setDeletingAgentLoading(null));
  };

  const exportAgent = async (agentId: string, agentName: string) => {
    try {
      const res = await fetch(`/api/agent/${agentId}/export`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+?)"/);
      const filename = match?.[1] ?? `agent-${agentName}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to export agent");
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await fetch("/api/agent/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      mutateAgents();
      toast.success(`Agent "${data.name}" imported`);
    } catch (err: any) {
      toast.error(err.message || "Failed to import agent");
    } finally {
      setImporting(false);
    }
  };

  // Determine the correct route for an agent card click based on type
  const getAgentHref = (agent: AgentSummary) => {
    if (agent.agentType === "snowflake_cortex") {
      return `/agent/snowflake/${agent.id}`;
    }
    if (agent.agentType === "a2a_remote") {
      return `/agent/a2a/${agent.id}`;
    }
    return `/agent/${agent.id}`;
  };

  // Check if user can create agents using Better Auth permissions
  const canCreate = canCreateAgent(userRole);

  return (
    <div className="w-full flex flex-col gap-4 p-8">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold" data-testid="agents-title">
          {t("Layout.agents")}
        </h1>
        {canCreate && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              disabled={importing}
              onClick={() => importInputRef.current?.click()}
            >
              <Upload className="size-4" />
              {importing ? "Importing…" : "Import"}
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleImportFile}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  data-testid="create-agent-button"
                  className="gap-1"
                >
                  <Plus className="size-4" />
                  {t("Agent.newAgent")}
                  <ChevronDown className="size-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => router.push("/agent/new")}>
                  <Plus className="size-4" />
                  Create Agent
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => router.push("/agent/snowflake/new")}
                >
                  <Snowflake className="size-4 text-blue-500" />
                  Snowflake Intelligence
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/agent/a2a/new")}>
                  <Waypoints className="size-4 text-emerald-600" />
                  A2A Agent
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* My Agents Section */}
      {canCreate && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{t("Agent.myAgents")}</h2>
            <div className="flex-1 h-px bg-border" />
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {canCreate && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Card
                    className="relative bg-secondary overflow-hidden cursor-pointer hover:bg-input transition-colors h-[196px]"
                    data-testid="create-agent-card"
                  >
                    <div className="absolute inset-0 w-full h-full opacity-50">
                      <BackgroundPaths />
                    </div>
                    <CardHeader>
                      <CardTitle>
                        <h1 className="text-lg font-bold">
                          {t("Agent.newAgent")}
                        </h1>
                      </CardTitle>
                      <CardDescription className="mt-2">
                        <p>{t("Layout.createYourOwnAgent")}</p>
                      </CardDescription>
                      <div className="mt-auto ml-auto flex-1">
                        <Button
                          variant="ghost"
                          size="lg"
                          className="pointer-events-none"
                        >
                          {t("Common.create")}
                          <ArrowUpRight className="size-3.5" />
                        </Button>
                      </div>
                    </CardHeader>
                  </Card>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => router.push("/agent/new")}>
                    <Plus className="size-4 mr-2" />+ Create Agent
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => router.push("/agent/snowflake/new")}
                  >
                    <Snowflake className="size-4 mr-2 text-blue-500" />+
                    Snowflake Intelligence
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {myAgents.map((agent) => (
              <ShareableCard
                key={agent.id}
                type="agent"
                item={agent}
                href={getAgentHref(agent)}
                onVisibilityChange={updateVisibility}
                isVisibilityChangeLoading={visibilityChangeLoading === agent.id}
                isDeleteLoading={deletingAgentLoading === agent.id}
                onDelete={deleteAgent}
                renderActions={() => (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          exportAgent(agent.id, agent.name);
                        }}
                      >
                        <Download className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Export agent</TooltipContent>
                  </Tooltip>
                )}
              />
            ))}
          </div>
        </div>
      )}

      {/* Shared/Available Agents Section */}
      <div className="flex flex-col gap-4 mt-8">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">
            {canCreate ? t("Agent.sharedAgents") : t("Agent.availableAgents")}
          </h2>
          <div className="flex-1 h-px bg-border" />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sharedAgents.map((agent) => (
            <ShareableCard
              key={agent.id}
              type="agent"
              item={agent}
              isOwner={false}
              href={getAgentHref(agent)}
              onBookmarkToggle={toggleBookmark}
              isBookmarkToggleLoading={isBookmarkLoading(agent.id)}
            />
          ))}
          {sharedAgents.length === 0 && (
            <Card className="col-span-full bg-transparent border-none">
              <CardHeader className="text-center py-12">
                <CardTitle>
                  {canCreate
                    ? t("Agent.noSharedAgents")
                    : t("Agent.noAvailableAgents")}
                </CardTitle>
                <CardDescription>
                  {canCreate
                    ? t("Agent.noSharedAgentsDescription")
                    : t("Agent.noAvailableAgentsDescription")}
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
