"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CopyIcon,
  KeyRound,
  RefreshCwIcon,
  ShieldAlertIcon,
  WaypointsIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "ui/button";
import { Label } from "ui/label";
import { Switch } from "ui/switch";

interface A2APublishPanelProps {
  agentId?: string;
  initialEnabled?: boolean;
  initialPreview?: string | null;
  isOwner?: boolean;
  embedded?: boolean;
}

export function A2APublishPanel({
  agentId,
  initialEnabled = false,
  initialPreview = null,
  isOwner = true,
  embedded = false,
}: A2APublishPanelProps) {
  const [browserOrigin, setBrowserOrigin] = useState("");
  const [enabled, setEnabled] = useState(initialEnabled);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyPreview, setKeyPreview] = useState(initialPreview);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  const localStorageKey = useMemo(
    () => (agentId ? `wave:agent-mcp-api-key:${agentId}` : null),
    [agentId],
  );
  const rpcUrl = useMemo(() => {
    if (!browserOrigin || !agentId) return "";
    return `${browserOrigin}/api/a2a/agent/${agentId}`;
  }, [agentId, browserOrigin]);
  const streamUrl = useMemo(() => {
    if (!rpcUrl) return "";
    return `${rpcUrl}/stream`;
  }, [rpcUrl]);
  const cardUrl = useMemo(() => {
    if (!rpcUrl) return "";
    return `${rpcUrl}/.well-known/agent-card.json`;
  }, [rpcUrl]);
  const configSnippet = useMemo(() => {
    return JSON.stringify(
      {
        agentCardUrl:
          cardUrl ||
          "https://your-domain/api/a2a/agent/{agentId}/.well-known/agent-card.json",
        headers: {
          Authorization: `Bearer ${apiKey ?? "YOUR_AGENT_API_KEY"}`,
        },
      },
      null,
      2,
    );
  }, [apiKey, cardUrl]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setBrowserOrigin(window.location.origin);
    }
  }, []);

  useEffect(() => {
    setEnabled(initialEnabled);
  }, [initialEnabled]);

  useEffect(() => {
    setKeyPreview(initialPreview);
  }, [initialPreview]);

  useEffect(() => {
    if (!localStorageKey || typeof window === "undefined") return;

    const removeStored = () => {
      localStorage.removeItem(localStorageKey);
    };

    try {
      const raw = localStorage.getItem(localStorageKey);
      if (!raw) return;

      const parsed = JSON.parse(raw) as { key?: string; preview?: string };
      if (!parsed?.key) {
        removeStored();
        return;
      }

      const storedPreview = parsed.preview || parsed.key.slice(-4);
      if (!keyPreview || keyPreview !== storedPreview) {
        removeStored();
        return;
      }

      setApiKey(parsed.key);
    } catch {
      removeStored();
    }
  }, [keyPreview, localStorageKey]);

  const copyToClipboard = useCallback((value: string) => {
    navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard");
  }, []);

  const handleGenerateKey = useCallback(async () => {
    if (!agentId || !localStorageKey) return;

    setIsGenerating(true);
    try {
      const response = await fetch(`/api/agent/${agentId}/mcp-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate key");
      }

      const data = await response.json();
      setApiKey(data.key);
      setKeyPreview(data.preview);
      localStorage.setItem(
        localStorageKey,
        JSON.stringify({
          key: data.key,
          preview: data.preview,
          createdAt: Date.now(),
        }),
      );
      toast.success("External access API key generated");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to generate external access key",
      );
    } finally {
      setIsGenerating(false);
    }
  }, [agentId, localStorageKey]);

  const handleRevokeKey = useCallback(async () => {
    if (!agentId || !localStorageKey) return;

    setIsRevoking(true);
    try {
      const response = await fetch(`/api/agent/${agentId}/mcp-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });

      if (!response.ok) {
        throw new Error("Failed to revoke key");
      }

      localStorage.removeItem(localStorageKey);
      setApiKey(null);
      setKeyPreview(null);
      setEnabled(false);
      toast.success("External access API key revoked");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to revoke external access key",
      );
    } finally {
      setIsRevoking(false);
    }
  }, [agentId, localStorageKey]);

  const handleToggleEnabled = useCallback(
    async (nextEnabled: boolean) => {
      if (!agentId) return;

      setIsToggling(true);
      try {
        const response = await fetch(`/api/agent/${agentId}/a2a-key`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: nextEnabled }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || "Failed to update A2A publish state");
        }

        setEnabled(nextEnabled);
        toast.success(
          nextEnabled ? "A2A publishing enabled" : "A2A publishing disabled",
        );
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to update A2A publish state",
        );
      } finally {
        setIsToggling(false);
      }
    },
    [agentId],
  );

  if (!agentId) {
    return (
      <div
        className={
          embedded
            ? "flex items-start gap-3"
            : "border rounded-xl p-4 flex items-start gap-3"
        }
      >
        <ShieldAlertIcon className="size-4 mt-0.5 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">Save this agent first</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create the agent before exposing it as an A2A server.
          </p>
        </div>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div
        className={
          embedded
            ? "flex items-start gap-3"
            : "border rounded-xl p-4 flex items-start gap-3"
        }
      >
        <ShieldAlertIcon className="size-4 mt-0.5 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">Owner access only</p>
          <p className="text-xs text-muted-foreground mt-1">
            Only the owner can manage A2A publish settings and API keys.
          </p>
        </div>
      </div>
    );
  }

  const isBusy = isGenerating || isRevoking || isToggling;

  return (
    <div className={embedded ? "space-y-4" : "border rounded-xl p-4 space-y-4"}>
      {embedded ? (
        <div className="flex items-start justify-between gap-4 rounded-lg border bg-secondary/30 p-3">
          <div className="space-y-1">
            <p className="text-xs font-medium">Enable publishing</p>
            <p className="text-xs text-muted-foreground">
              Expose this agent through its A2A endpoints and require the
              generated bearer key.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={handleToggleEnabled}
            disabled={isBusy}
          />
        </div>
      ) : (
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <WaypointsIcon className="size-4 text-primary" />
              <p className="text-sm font-medium">Publish via A2A</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Expose this agent as a per-agent A2A server endpoint.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={handleToggleEnabled}
            disabled={isBusy}
          />
        </div>
      )}

      {embedded ? (
        <div className="rounded-lg border bg-secondary/30 p-3 space-y-1">
          <p className="text-xs font-medium">Authentication</p>
          <p className="text-xs text-muted-foreground">
            Uses the External Agent Access API key from this page as the A2A
            bearer token.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label className="text-sm">External Access API Key</Label>
          <p className="text-xs text-muted-foreground">
            Shared across A2A publishing and other external agent transports.
          </p>
          <div className="flex items-center gap-2">
            <div className="flex-1 px-3 py-2 rounded-lg border bg-secondary/40 text-xs font-mono break-all">
              {apiKey ? (
                <span>{apiKey}</span>
              ) : keyPreview ? (
                <span className="text-muted-foreground">
                  ••••••••••••{keyPreview}
                </span>
              ) : (
                <span className="text-muted-foreground italic">
                  No API key generated
                </span>
              )}
            </div>
            {apiKey && (
              <Button
                size="icon"
                variant="outline"
                className="size-9 shrink-0"
                onClick={() => copyToClipboard(apiKey)}
              >
                <CopyIcon className="size-3.5" />
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 shrink-0"
              onClick={handleGenerateKey}
              disabled={isBusy}
            >
              {isGenerating ? (
                <RefreshCwIcon className="size-3.5 animate-spin" />
              ) : (
                <KeyRound className="size-3.5" />
              )}
              {keyPreview ? "Regenerate" : "Generate"}
            </Button>
          </div>
          {keyPreview && (
            <Button
              size="sm"
              variant="ghost"
              className="px-0 text-xs text-muted-foreground hover:text-destructive w-fit"
              onClick={handleRevokeKey}
              disabled={isBusy}
            >
              {isRevoking && (
                <RefreshCwIcon className="size-3.5 animate-spin mr-1" />
              )}
              Revoke API key
            </Button>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-sm">Agent Card URL</Label>
        <div className="flex items-center gap-2">
          <div className="flex-1 px-3 py-2 rounded-lg border bg-secondary/40 text-xs font-mono truncate">
            {cardUrl}
          </div>
          <Button
            size="icon"
            variant="outline"
            className="size-9 shrink-0"
            onClick={() => copyToClipboard(cardUrl)}
            disabled={!cardUrl}
          >
            <CopyIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">JSON-RPC Endpoint</Label>
        <div className="flex items-center gap-2">
          <div className="flex-1 px-3 py-2 rounded-lg border bg-secondary/40 text-xs font-mono truncate">
            {rpcUrl}
          </div>
          <Button
            size="icon"
            variant="outline"
            className="size-9 shrink-0"
            onClick={() => copyToClipboard(rpcUrl)}
            disabled={!rpcUrl}
          >
            <CopyIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Streaming Endpoint</Label>
        <div className="flex items-center gap-2">
          <div className="flex-1 px-3 py-2 rounded-lg border bg-secondary/40 text-xs font-mono truncate">
            {streamUrl}
          </div>
          <Button
            size="icon"
            variant="outline"
            className="size-9 shrink-0"
            onClick={() => copyToClipboard(streamUrl)}
            disabled={!streamUrl}
          >
            <CopyIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Connection Config</Label>
        <div className="relative">
          <pre className="text-xs p-3 bg-secondary/40 border rounded-lg overflow-x-auto">
            {configSnippet}
          </pre>
          <Button
            size="icon"
            variant="outline"
            className="size-7 absolute top-2 right-2"
            onClick={() => copyToClipboard(configSnippet)}
          >
            <CopyIcon className="size-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
