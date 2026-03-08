"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { safe } from "ts-safe";
import { Loader, RefreshCwIcon, SearchIcon } from "lucide-react";
import type { Agent, AgentIcon } from "app-types/agent";
import type { A2AAgentConfigSafe, A2AAgentCard } from "app-types/a2a-agent";
import {
  A2AAgentConfigCreateSchema,
  A2AAgentDiscoverSchema,
} from "app-types/a2a-agent";
import { fetcher } from "lib/utils";
import { BACKGROUND_COLORS } from "lib/const";
import { useMutateAgents } from "@/hooks/queries/use-agents";
import { handleErrorWithToast } from "ui/shared-toast";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { ScrollArea } from "ui/scroll-area";
import { Separator } from "ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "ui/select";
import { Textarea } from "ui/textarea";
import {
  ShareableActions,
  type Visibility,
} from "@/components/shareable-actions";
import { AgentIconPicker } from "./agent-icon-picker";
import { A2APublishPanel } from "./a2a-publish-panel";

type A2AFormState = {
  name: string;
  description: string;
  icon: AgentIcon;
  visibility: "public" | "private" | "readonly";
  url: string;
  authMode: "none" | "bearer" | "header";
  authHeaderName: string;
  authSecret: string;
  agentCardUrl: string;
  rpcUrl: string;
  agentCard: A2AAgentCard | null;
  lastDiscoveredAt: string;
};

const A2A_REDACTED_SECRET = "••••••••";

function defaultAgentIcon(): AgentIcon {
  return {
    type: "emoji",
    value:
      "https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f916.png",
    style: {
      backgroundColor: BACKGROUND_COLORS[0],
    },
  };
}

function mapCardToIcon(card: A2AAgentCard | null, fallback: AgentIcon) {
  if (!card?.iconUrl) return fallback;

  return {
    ...fallback,
    value: card.iconUrl,
  };
}

function createInitialFormState(
  initialAgent?: Agent,
  initialConfig?: A2AAgentConfigSafe,
): A2AFormState {
  const fallbackIcon = initialAgent?.icon ?? defaultAgentIcon();

  if (!initialAgent || !initialConfig) {
    return {
      name: "",
      description: "",
      icon: fallbackIcon,
      visibility: "private",
      url: "",
      authMode: "none",
      authHeaderName: "",
      authSecret: "",
      agentCardUrl: "",
      rpcUrl: "",
      agentCard: null,
      lastDiscoveredAt: "",
    };
  }

  return {
    name: initialAgent.name,
    description: initialAgent.description ?? "",
    icon:
      initialAgent.icon ?? mapCardToIcon(initialConfig.agentCard, fallbackIcon),
    visibility: initialAgent.visibility ?? "private",
    url: initialConfig.inputUrl,
    authMode: initialConfig.authMode,
    authHeaderName: initialConfig.authHeaderName ?? "",
    authSecret: initialConfig.hasAuthSecret ? A2A_REDACTED_SECRET : "",
    agentCardUrl: initialConfig.agentCardUrl,
    rpcUrl: initialConfig.rpcUrl,
    agentCard: initialConfig.agentCard,
    lastDiscoveredAt: initialConfig.lastDiscoveredAt
      ? new Date(initialConfig.lastDiscoveredAt).toISOString()
      : "",
  };
}

interface A2AAgentFormProps {
  initialAgent?: Agent;
  initialConfig?: A2AAgentConfigSafe;
  userId: string;
  isOwner?: boolean;
  hasEditAccess?: boolean;
}

export default function A2AAgentForm({
  initialAgent,
  initialConfig,
  userId: _userId,
  isOwner = true,
  hasEditAccess = true,
}: A2AAgentFormProps) {
  const router = useRouter();
  const mutateAgents = useMutateAgents();
  const [isSaving, setIsSaving] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isVisibilityChangeLoading, setIsVisibilityChangeLoading] =
    useState(false);
  const [form, setForm] = useState<A2AFormState>(() =>
    createInitialFormState(initialAgent, initialConfig),
  );

  const isEditing = Boolean(initialAgent);
  const isLoading = isSaving || isDiscovering || isVisibilityChangeLoading;

  const setField = useCallback(
    <K extends keyof A2AFormState>(key: K, value: A2AFormState[K]) => {
      setForm((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const updateVisibility = useCallback(
    async (visibility: Visibility) => {
      if (!initialAgent?.id) {
        setField("visibility", visibility);
        return;
      }

      safe(() => setIsVisibilityChangeLoading(true))
        .map(async () =>
          fetcher(`/api/agent/${initialAgent.id}`, {
            method: "PUT",
            body: JSON.stringify({ visibility }),
          }),
        )
        .ifOk(() => {
          setField("visibility", visibility);
          mutateAgents({ id: initialAgent.id, visibility });
          toast.success("Visibility updated");
        })
        .ifFail(handleErrorWithToast)
        .watch(() => setIsVisibilityChangeLoading(false));
    },
    [initialAgent?.id, mutateAgents, setField],
  );

  const discoverAgent = useCallback(async () => {
    const parsed = A2AAgentDiscoverSchema.safeParse({
      url: form.url,
      authMode: form.authMode,
      authHeaderName: form.authHeaderName || undefined,
      authSecret:
        form.authMode === "none" ? undefined : form.authSecret || undefined,
    });

    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Validation error");
      return;
    }

    setIsDiscovering(true);
    try {
      const result = await fetcher("/api/agent/a2a/discover", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });

      setForm((current) => ({
        ...current,
        name: current.name || result.agentCard.name,
        description: current.description || result.agentCard.description,
        icon:
          current.icon?.value !== defaultAgentIcon().value
            ? current.icon
            : mapCardToIcon(
                result.agentCard,
                current.icon ?? defaultAgentIcon(),
              ),
        agentCardUrl: result.agentCardUrl,
        rpcUrl: result.rpcUrl,
        agentCard: result.agentCard,
        lastDiscoveredAt: new Date(
          result.lastDiscoveredAt ?? Date.now(),
        ).toISOString(),
      }));

      toast.success("A2A agent discovered");
    } catch (error) {
      handleErrorWithToast(error as Error);
    } finally {
      setIsDiscovering(false);
    }
  }, [form]);

  const saveAgent = useCallback(() => {
    const parsedConfig = A2AAgentConfigCreateSchema.safeParse({
      inputUrl: form.url,
      agentCardUrl: form.agentCardUrl,
      rpcUrl: form.rpcUrl,
      authMode: form.authMode,
      authHeaderName:
        form.authMode === "header"
          ? form.authHeaderName || undefined
          : undefined,
      authSecret:
        form.authMode === "none" ? undefined : form.authSecret || undefined,
      agentCard: form.agentCard,
      lastDiscoveredAt: form.lastDiscoveredAt || undefined,
    });

    if (!parsedConfig.success) {
      toast.error(
        parsedConfig.error.issues[0]?.message ??
          "Discover the remote agent before saving",
      );
      return;
    }

    if (initialAgent) {
      safe(() => setIsSaving(true))
        .map(async () => {
          await fetcher(`/api/agent/${initialAgent.id}`, {
            method: "PUT",
            body: JSON.stringify({
              name: form.name,
              description: form.description,
              icon: form.icon,
              visibility: form.visibility,
            }),
          });
          await fetcher(`/api/agent/a2a/${initialAgent.id}`, {
            method: "PUT",
            body: JSON.stringify(parsedConfig.data),
          });
        })
        .ifOk(() => {
          mutateAgents({
            id: initialAgent.id,
            name: form.name,
            description: form.description,
            icon: form.icon,
            visibility: form.visibility,
            agentType: "a2a_remote",
          });
          toast.success("Agent updated");
          router.push("/agents");
        })
        .ifFail(handleErrorWithToast)
        .watch(() => setIsSaving(false));
      return;
    }

    safe(() => setIsSaving(true))
      .map(async () =>
        fetcher("/api/agent/a2a", {
          method: "POST",
          body: JSON.stringify({
            name: form.name,
            description: form.description || undefined,
            icon: form.icon,
            visibility: form.visibility,
            a2aConfig: parsedConfig.data,
          }),
        }),
      )
      .ifOk((newAgent) => {
        mutateAgents(newAgent);
        toast.success("Agent created");
        router.push("/agents");
      })
      .ifFail(handleErrorWithToast)
      .watch(() => setIsSaving(false));
  }, [form, initialAgent, mutateAgents, router]);

  const discoveredInfo = useMemo(() => {
    if (!form.agentCard) return [];

    return [
      { label: "Protocol", value: form.agentCard.protocolVersion },
      { label: "Version", value: form.agentCard.version },
      {
        label: "Skills",
        value: `${form.agentCard.skills?.length ?? 0}`,
      },
      {
        label: "Streaming",
        value: form.agentCard.capabilities?.streaming ? "Yes" : "No",
      },
    ];
  }, [form.agentCard]);

  return (
    <ScrollArea className="h-full w-full relative">
      <div className="w-full h-8 absolute bottom-0 left-0 bg-gradient-to-t from-background to-transparent z-20 pointer-events-none" />
      <div className="z-10 relative flex flex-col gap-4 px-8 pt-8 pb-14 max-w-3xl h-full mx-auto">
        <div className="sticky top-0 bg-background z-10 flex items-center justify-between pb-4 gap-2">
          <div className="w-full h-8 absolute top-[100%] left-0 bg-gradient-to-b from-background to-transparent z-20 pointer-events-none" />
          <p className="w-full text-2xl font-bold">
            {isEditing ? "Edit A2A Agent" : "Create A2A Agent"}
          </p>
          <ShareableActions
            type="agent"
            visibility={form.visibility}
            isOwner={isOwner}
            canChangeVisibility={hasEditAccess}
            onVisibilityChange={updateVisibility}
            isVisibilityChangeLoading={isVisibilityChangeLoading}
            disabled={!hasEditAccess}
          />
        </div>

        <div className="space-y-6">
          <div className="space-y-4 border rounded-xl p-4">
            <div className="flex items-start gap-4">
              <AgentIconPicker
                icon={form.icon}
                disabled={!hasEditAccess}
                onChange={(icon) => setField("icon", icon)}
              />
              <div className="flex-1 space-y-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={form.name}
                    onChange={(event) => setField("name", event.target.value)}
                    disabled={isLoading || !hasEditAccess}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    rows={3}
                    value={form.description}
                    onChange={(event) =>
                      setField("description", event.target.value)
                    }
                    disabled={isLoading || !hasEditAccess}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4 border rounded-xl p-4">
            <div className="space-y-2">
              <Label>Remote Agent URL</Label>
              <Input
                placeholder="https://example.com/.well-known/agent-card.json"
                value={form.url}
                onChange={(event) => setField("url", event.target.value)}
                disabled={isLoading || !hasEditAccess}
              />
              <p className="text-xs text-muted-foreground">
                Enter either the agent card URL or the agent base URL.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Authentication</Label>
                <Select
                  value={form.authMode}
                  onValueChange={(value) =>
                    setField("authMode", value as A2AFormState["authMode"])
                  }
                  disabled={isLoading || !hasEditAccess}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="bearer">Bearer token</SelectItem>
                    <SelectItem value="header">Custom header</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {form.authMode === "header" && (
                <div className="space-y-2">
                  <Label>Header Name</Label>
                  <Input
                    placeholder="X-API-Key"
                    value={form.authHeaderName}
                    onChange={(event) =>
                      setField("authHeaderName", event.target.value)
                    }
                    disabled={isLoading || !hasEditAccess}
                  />
                </div>
              )}
            </div>

            {form.authMode !== "none" && (
              <div className="space-y-2">
                <Label>
                  {form.authMode === "bearer" ? "Bearer Token" : "Header Value"}
                </Label>
                <Input
                  type="password"
                  value={form.authSecret}
                  onChange={(event) =>
                    setField("authSecret", event.target.value)
                  }
                  disabled={isLoading || !hasEditAccess}
                />
              </div>
            )}

            <Button
              className="gap-2"
              variant="outline"
              onClick={discoverAgent}
              disabled={isLoading || !hasEditAccess}
            >
              {isDiscovering ? (
                <RefreshCwIcon className="size-4 animate-spin" />
              ) : (
                <SearchIcon className="size-4" />
              )}
              Discover Agent
            </Button>
          </div>

          <div className="space-y-4 border rounded-xl p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Discovered Agent Card</p>
                <p className="text-xs text-muted-foreground">
                  Cached remote metadata used for chat and A2A wrapping.
                </p>
              </div>
              {form.lastDiscoveredAt && (
                <p className="text-xs text-muted-foreground">
                  {new Date(form.lastDiscoveredAt).toLocaleString()}
                </p>
              )}
            </div>

            {!form.agentCard ? (
              <div className="rounded-lg border bg-secondary/30 p-4 text-sm text-muted-foreground">
                Discover a remote agent to load its card, RPC URL, and skills.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  {discoveredInfo.map((item) => (
                    <div
                      key={item.label}
                      className="rounded-lg border bg-secondary/30 p-3"
                    >
                      <p className="text-xs font-medium">{item.label}</p>
                      <p className="text-sm mt-1 break-all">{item.value}</p>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <Label>Agent Card URL</Label>
                  <Input value={form.agentCardUrl} readOnly />
                </div>

                <div className="space-y-2">
                  <Label>RPC URL</Label>
                  <Input value={form.rpcUrl} readOnly />
                </div>

                <div className="space-y-2">
                  <Label>Skills</Label>
                  <div className="rounded-lg border bg-secondary/30 p-3 space-y-2">
                    {(form.agentCard.skills ?? []).length > 0 ? (
                      (form.agentCard.skills ?? []).map((skill) => (
                        <div key={skill.id}>
                          <p className="text-sm font-medium">{skill.name}</p>
                          {skill.description && (
                            <p className="text-xs text-muted-foreground">
                              {skill.description}
                            </p>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No skills declared by the remote card.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <A2APublishPanel
            agentId={initialAgent?.id}
            initialEnabled={initialAgent?.a2aEnabled ?? false}
            initialPreview={
              initialAgent?.mcpApiKeyPreview ??
              initialAgent?.a2aApiKeyPreview ??
              null
            }
            isOwner={isOwner}
          />

          <Separator />

          <div className="flex justify-end">
            <Button
              className="gap-2"
              onClick={saveAgent}
              disabled={isLoading || !hasEditAccess}
            >
              {isSaving ? (
                <>
                  Saving
                  <Loader className="size-4 animate-spin" />
                </>
              ) : isEditing ? (
                "Save Changes"
              ) : (
                "Create Agent"
              )}
            </Button>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
