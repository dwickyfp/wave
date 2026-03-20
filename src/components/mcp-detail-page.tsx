"use client";

import { refreshMcpClientAction } from "@/app/api/mcp/actions";
import { appStore } from "@/app/store";
import JsonView from "@/components/ui/json-view";
import type { MCPServerDetail } from "app-types/mcp";
import type { BasicUser } from "app-types/user";
import { fetcher } from "lib/utils";
import { redriectMcpOauth } from "lib/ai/mcp/oauth-redirect";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  FlaskConical,
  KeyRound,
  Loader2,
  RefreshCw,
  Settings2,
  ShieldAlert,
  SquarePen,
  ToggleLeft,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "ui/alert";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
import { Label } from "ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "ui/select";
import { Skeleton } from "ui/skeleton";
import { Switch } from "ui/switch";

const STATUS_STYLES: Record<string, string> = {
  connected: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  disconnected: "bg-muted text-muted-foreground border-border",
  loading: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  authorizing: "bg-blue-500/10 text-blue-600 border-blue-500/20",
};

type Props = {
  id: string;
  user: BasicUser;
};

export function MCPPublishDetailPage({ id, user }: Props) {
  const appStoreMutate = appStore((state) => state.mutate);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isUpdatingPublish, setIsUpdatingPublish] = useState(false);
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [isRevokingKey, setIsRevokingKey] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);

  const { data, error, isLoading, mutate } = useSWR<MCPServerDetail>(
    `/api/mcp/${id}`,
    fetcher,
    {
      revalidateOnFocus: false,
    },
  );

  const canManage = data?.canManage ?? user.role === "admin";
  const storageKey = useMemo(() => `mcp:published-api-key:${id}`, [id]);
  const keyPreview = data?.publishApiKeyPreview ?? null;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const removeStored = () => {
      localStorage.removeItem(storageKey);
    };

    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        setApiKey(null);
        return;
      }

      const parsed = JSON.parse(raw) as { key?: string; preview?: string };
      if (!parsed?.key) {
        removeStored();
        setApiKey(null);
        return;
      }

      const storedPreview = parsed.preview || parsed.key.slice(-4);
      if (!keyPreview || storedPreview !== keyPreview) {
        removeStored();
        setApiKey(null);
        return;
      }

      setApiKey(parsed.key);
    } catch {
      removeStored();
      setApiKey(null);
    }
  }, [keyPreview, storageKey]);

  const toolCount = data?.toolInfo?.length ?? 0;
  const errorText = useMemo(() => {
    if (!data?.error) return null;
    if (typeof data.error === "string") return data.error;
    try {
      return JSON.stringify(data.error, null, 2);
    } catch {
      return "Unknown MCP error";
    }
  }, [data?.error]);

  const configSnippet = useMemo(() => {
    if (!data?.publishedUrl) return "";

    const snippet: Record<string, unknown> = {
      url: data.publishedUrl,
    };

    if (data.publishAuthMode === "bearer") {
      snippet.headers = {
        Authorization: `Bearer ${apiKey ?? "YOUR_MCP_API_KEY"}`,
      };
    }

    return JSON.stringify(snippet, null, 2);
  }, [apiKey, data?.publishAuthMode, data?.publishedUrl]);

  const copyToClipboard = useCallback((value: string) => {
    navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard");
  }, []);

  const revalidateAll = useCallback(async () => {
    await Promise.all([mutate(), globalMutate("/api/mcp/list")]);
  }, [mutate]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refreshMcpClientAction(id);
      await revalidateAll();
      toast.success("MCP server refreshed");
    } catch (refreshError) {
      toast.error(
        refreshError instanceof Error
          ? refreshError.message
          : "Failed to refresh MCP server",
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [id, revalidateAll]);

  const handleAuthorize = useCallback(async () => {
    try {
      await redriectMcpOauth(id);
      await revalidateAll();
      toast.success("MCP authorization complete");
    } catch (authorizeError) {
      toast.error(
        authorizeError instanceof Error
          ? authorizeError.message
          : "Failed to authorize MCP server",
      );
    }
  }, [id, revalidateAll]);

  const handleOpenCustomization = useCallback(() => {
    if (!data) return;

    appStoreMutate({
      mcpCustomizationPopup: {
        ...data,
        toolInfo: data.toolInfo ?? [],
      },
    });
  }, [appStoreMutate, data]);

  const updatePublishState = useCallback(
    async (next: { enabled: boolean; authMode: "none" | "bearer" }) => {
      setIsUpdatingPublish(true);
      try {
        await fetcher(`/api/mcp/${id}/publish`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });

        await revalidateAll();
        toast.success("Publish settings updated");
      } catch (publishError) {
        toast.error(
          publishError instanceof Error
            ? publishError.message
            : "Failed to update publish settings",
        );
      } finally {
        setIsUpdatingPublish(false);
      }
    },
    [id, revalidateAll],
  );

  const handleTogglePublish = useCallback(
    async (enabled: boolean) => {
      const authMode = data?.publishAuthMode ?? "none";
      await updatePublishState({ enabled, authMode });
    },
    [data?.publishAuthMode, updatePublishState],
  );

  const handleChangeAuthMode = useCallback(
    async (authMode: "none" | "bearer") => {
      const enabled =
        authMode === "bearer" && !keyPreview
          ? false
          : (data?.publishEnabled ?? false);

      await updatePublishState({ enabled, authMode });

      if (authMode === "bearer" && !keyPreview) {
        toast.message("Generate a key, then enable publishing.");
      }
    },
    [data?.publishEnabled, keyPreview, updatePublishState],
  );

  const handleGenerateKey = useCallback(async () => {
    setIsGeneratingKey(true);
    try {
      const result = await fetcher(`/api/mcp/${id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });

      const generatedKey = (result as { key: string; preview: string }).key;
      const preview = (result as { key: string; preview: string }).preview;

      localStorage.setItem(
        storageKey,
        JSON.stringify({
          key: generatedKey,
          preview,
          createdAt: Date.now(),
        }),
      );
      setApiKey(generatedKey);
      await revalidateAll();
      toast.success("Publish key generated");
    } catch (keyError) {
      toast.error(
        keyError instanceof Error
          ? keyError.message
          : "Failed to generate publish key",
      );
    } finally {
      setIsGeneratingKey(false);
    }
  }, [id, revalidateAll, storageKey]);

  const handleRevokeKey = useCallback(async () => {
    setIsRevokingKey(true);
    try {
      await fetcher(`/api/mcp/${id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });

      localStorage.removeItem(storageKey);
      setApiKey(null);
      await revalidateAll();
      toast.success("Publish key revoked");
    } catch (keyError) {
      toast.error(
        keyError instanceof Error
          ? keyError.message
          : "Failed to revoke publish key",
      );
    } finally {
      setIsRevokingKey(false);
    }
  }, [id, revalidateAll, storageKey]);

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
        <Link
          href="/mcp"
          className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to MCP
        </Link>
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Unable to load MCP server</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : "Unknown error"}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const statusClass = STATUS_STYLES[data.status] || STATUS_STYLES.disconnected;
  const busy = isUpdatingPublish || isGeneratingKey || isRevokingKey;

  return (
    <div
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6"
      data-testid="mcp-detail-page"
    >
      <Link
        href="/mcp"
        className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to MCP
      </Link>

      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">{data.name}</h1>
              <Badge variant="outline" className={statusClass}>
                {data.status}
              </Badge>
              <Badge variant="secondary">{data.visibility}</Badge>
              <Badge variant="secondary">{toolCount} tools</Badge>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Open the card list for navigation, then manage configuration,
              published access, and tool testing from this page.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {data.status === "authorizing" && canManage && (
              <Button
                variant="outline"
                className="gap-2"
                onClick={handleAuthorize}
              >
                <ShieldAlert className="size-4" />
                Authorize
              </Button>
            )}
            {canManage && (
              <Button
                variant="outline"
                className="gap-2"
                onClick={handleOpenCustomization}
              >
                <Settings2 className="size-4" />
                Customize
              </Button>
            )}
            {canManage && (
              <Link href={`/mcp/test/${encodeURIComponent(id)}`}>
                <Button variant="outline" className="gap-2">
                  <FlaskConical className="size-4" />
                  Tool Test
                </Button>
              </Link>
            )}
            {canManage && (
              <Link href={`/mcp/modify/${encodeURIComponent(id)}`}>
                <Button variant="outline" className="gap-2">
                  <SquarePen className="size-4" />
                  Edit Config
                </Button>
              </Link>
            )}
            {canManage && (
              <Button
                variant="outline"
                className="gap-2"
                onClick={handleRefresh}
                disabled={isRefreshing}
              >
                {isRefreshing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Refresh
              </Button>
            )}
          </div>
        </div>

        {errorText && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>MCP connection issue</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap break-all">
              {errorText}
            </AlertDescription>
          </Alert>
        )}

        {data.status === "authorizing" && canManage && (
          <Alert>
            <ShieldAlert className="size-4" />
            <AlertTitle>Authorization required</AlertTitle>
            <AlertDescription>
              This registered MCP server needs owner authorization before its
              tools can be used or published.
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        {canManage && data.config ? (
          <Card className="overflow-hidden" data-testid="mcp-config-panel">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings2 className="size-4" />
                Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-auto">
              <JsonView data={data.config} initialExpandDepth={3} />
            </CardContent>
          </Card>
        ) : null}

        <Card className="overflow-hidden" data-testid="mcp-tools-panel">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="size-4" />
              Available Tools
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {toolCount > 0 ? (
              data.toolInfo.map((tool) => (
                <div
                  key={tool.name}
                  className="rounded-xl border bg-secondary/30 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{tool.name}</p>
                    {tool.inputSchema?.required?.length ? (
                      <Badge variant="outline">
                        {tool.inputSchema.required.length} required
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 max-h-40 overflow-y-auto pr-1">
                    <p className="text-sm text-muted-foreground">
                      {tool.description || "No description"}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                No tools available yet. Refresh the server after its upstream
                MCP connection is ready.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {canManage && (
        <Card className="overflow-hidden" data-testid="mcp-publish-panel">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ToggleLeft className="size-4" />
              Publish as MCP Server
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-col gap-3 rounded-xl border bg-secondary/30 p-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Enable publishing</p>
                <p className="text-xs text-muted-foreground">
                  Expose this registered MCP as a new local MCP server endpoint.
                </p>
              </div>
              <Switch
                checked={data.publishEnabled ?? false}
                onCheckedChange={handleTogglePublish}
                disabled={busy}
                data-testid="mcp-publish-toggle"
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Authentication</Label>
                  <Select
                    value={data.publishAuthMode ?? "none"}
                    onValueChange={(value: "none" | "bearer") =>
                      handleChangeAuthMode(value)
                    }
                    disabled={busy}
                  >
                    <SelectTrigger data-testid="mcp-publish-auth-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Native / no key</SelectItem>
                      <SelectItem value="bearer">Bearer key</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Published URL</Label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 rounded-lg border bg-secondary/30 px-3 py-2 font-mono text-xs break-all">
                      {data.publishedUrl}
                    </div>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() =>
                        data.publishedUrl && copyToClipboard(data.publishedUrl)
                      }
                      disabled={!data.publishedUrl}
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                </div>

                {data.publishAuthMode === "bearer" && (
                  <div className="space-y-2">
                    <Label>Publish key</Label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 rounded-lg border bg-secondary/30 px-3 py-2 font-mono text-xs break-all">
                        {apiKey ? (
                          apiKey
                        ) : keyPreview ? (
                          <span className="text-muted-foreground">
                            ••••••••••••{keyPreview}
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">
                            No publish key generated
                          </span>
                        )}
                      </div>
                      {apiKey && (
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => copyToClipboard(apiKey)}
                        >
                          <Copy className="size-4" />
                        </Button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={handleGenerateKey}
                        disabled={busy}
                        data-testid="mcp-publish-generate-key"
                      >
                        {isGeneratingKey ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <KeyRound className="size-4" />
                        )}
                        {keyPreview ? "Regenerate Key" : "Generate Key"}
                      </Button>
                      {keyPreview && (
                        <Button
                          variant="ghost"
                          className="gap-2 text-muted-foreground hover:text-destructive"
                          onClick={handleRevokeKey}
                          disabled={busy}
                        >
                          {isRevokingKey ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <ShieldAlert className="size-4" />
                          )}
                          Revoke Key
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Connection snippet</Label>
                <div className="rounded-xl border bg-zinc-950 p-4 text-xs text-zinc-100">
                  <pre className="whitespace-pre-wrap break-all">
                    {configSnippet || "// Published URL not ready"}
                  </pre>
                </div>
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() =>
                      configSnippet && copyToClipboard(configSnippet)
                    }
                    disabled={!configSnippet}
                  >
                    <Copy className="size-4" />
                    Copy Snippet
                  </Button>
                </div>
              </div>
            </div>

            <Alert>
              <CheckCircle2 className="size-4" />
              <AlertTitle>Publish scope</AlertTitle>
              <AlertDescription>
                V1 publishes tools only. It forwards tool calls to the
                registered MCP connection and reuses its existing upstream
                auth/config.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
