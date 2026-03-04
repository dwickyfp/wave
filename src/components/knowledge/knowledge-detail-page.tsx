"use client";

import { useState } from "react";
import { KnowledgeGroup, KnowledgeDocument } from "app-types/knowledge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/tabs";
import { KnowledgeDocumentsTab } from "./knowledge-documents-tab";
import { KnowledgeUsageTab } from "./knowledge-usage-tab";
import { KnowledgePlaygroundTab } from "./knowledge-playground-tab";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Switch } from "ui/switch";
import { Label } from "ui/label";
import {
  BrainIcon,
  ChevronLeftIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  KeyIcon,
  RefreshCwIcon,
  ServerIcon,
} from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "lib/utils";

interface Props {
  group: KnowledgeGroup;
  initialDocuments: KnowledgeDocument[];
  userId: string;
}

export function KnowledgeDetailPage({
  group,
  initialDocuments,
  userId,
}: Props) {
  const isOwner = group.userId === userId;
  const [mcpOpen, setMcpOpen] = useState(false);
  const [mcpEnabled, setMcpEnabled] = useState(group.mcpEnabled);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyPreview, setKeyPreview] = useState(group.mcpApiKeyPreview);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [togglingMcp, setTogglingMcp] = useState(false);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const mcpUrl = `${baseUrl}/api/mcp/knowledge/${group.id}`;

  const handleGenerateKey = async () => {
    setGeneratingKey(true);
    try {
      const res = await fetch(`/api/knowledge/${group.id}/mcp-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });
      const data = await res.json();
      setApiKey(data.key);
      setKeyPreview(data.preview);
      toast.success("API key generated — copy it now, it won't be shown again");
    } catch {
      toast.error("Failed to generate API key");
    } finally {
      setGeneratingKey(false);
    }
  };

  const handleToggleMcp = async (enabled: boolean) => {
    setTogglingMcp(true);
    try {
      await fetch(`/api/knowledge/${group.id}/mcp-key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      setMcpEnabled(enabled);
      toast.success(`MCP ${enabled ? "enabled" : "disabled"}`);
    } catch {
      toast.error("Failed to update MCP status");
    } finally {
      setTogglingMcp(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const mcpConfig = JSON.stringify(
    {
      type: "http",
      url: mcpUrl,
      headers: { Authorization: `Bearer ${apiKey ?? "YOUR_API_KEY"}` },
    },
    null,
    2,
  );

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 max-w-6xl mx-auto w-full">
      {/* Back */}
      <Link
        href="/knowledge"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ChevronLeftIcon className="size-4" />
        ContextX
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <div
            style={{ backgroundColor: group.icon?.style?.backgroundColor }}
            className={cn(
              "p-2.5 rounded-xl flex items-center justify-center ring ring-background border shrink-0",
              !group.icon?.style?.backgroundColor && "bg-primary/10",
            )}
          >
            {group.icon?.value ? (
              <Avatar className="size-8">
                <AvatarImage src={group.icon.value} />
                <AvatarFallback>{group.name[0]}</AvatarFallback>
              </Avatar>
            ) : (
              <BrainIcon className="size-7 text-primary" />
            )}
          </div>

          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold">{group.name}</h1>
            {group.description && (
              <p className="text-sm text-muted-foreground">
                {group.description}
              </p>
            )}
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <Badge variant="secondary" className="text-xs">
                {group.embeddingProvider}/{group.embeddingModel}
              </Badge>
              {group.rerankingModel && (
                <Badge variant="secondary" className="text-xs">
                  rerank: {group.rerankingModel}
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">
                {group.visibility}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Created {format(group.createdAt, "MMM d, yyyy")}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* MCP Section (owner only) */}
      {isOwner && (
        <div className="border rounded-xl overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors"
            onClick={() => setMcpOpen((o) => !o)}
          >
            <div className="flex items-center gap-2">
              <ServerIcon className="size-4 text-primary" />
              <span className="text-sm font-medium">MCP Server</span>
              {mcpEnabled && (
                <Badge className="text-xs px-1.5 py-0 bg-green-500/10 text-green-600 border border-green-500">
                  Active
                </Badge>
              )}
            </div>
            {mcpOpen ? (
              <ChevronUpIcon className="size-4" />
            ) : (
              <ChevronDownIcon className="size-4" />
            )}
          </button>

          {mcpOpen && (
            <div className="px-4 pb-4 flex flex-col gap-4 border-t">
              <div className="flex items-center justify-between pt-3">
                <div>
                  <Label className="text-sm font-medium">Enable MCP</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Expose this knowledge group as an MCP tool
                  </p>
                </div>
                <Switch
                  checked={mcpEnabled}
                  onCheckedChange={handleToggleMcp}
                  disabled={togglingMcp}
                />
              </div>

              {/* API Key management */}
              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium">API Key</Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2 text-sm rounded-lg bg-secondary/40 border font-mono">
                    {apiKey ? (
                      <span className="text-green-600">{apiKey}</span>
                    ) : keyPreview ? (
                      <span className="text-muted-foreground">
                        ••••••••••••{keyPreview}
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic">
                        No key generated
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
                    disabled={generatingKey}
                  >
                    {generatingKey ? (
                      <RefreshCwIcon className="size-3.5 animate-spin" />
                    ) : (
                      <KeyIcon className="size-3.5" />
                    )}
                    {keyPreview ? "Regenerate" : "Generate"}
                  </Button>
                </div>
                {apiKey && (
                  <p className="text-xs text-amber-600">
                    Save this key now — it won't be shown again after you leave
                    this page.
                  </p>
                )}
              </div>

              {/* MCP endpoint info */}
              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium">MCP Endpoint</Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2 text-xs rounded-lg bg-secondary/40 border font-mono truncate">
                    {mcpUrl}
                  </div>
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-9 shrink-0"
                    onClick={() => copyToClipboard(mcpUrl)}
                  >
                    <CopyIcon className="size-3.5" />
                  </Button>
                </div>
              </div>

              {/* Config snippet */}
              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium">Connection Config</Label>
                <div className="relative">
                  <pre className="text-xs p-3 bg-secondary/40 border rounded-lg overflow-x-auto">
                    {mcpConfig}
                  </pre>
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-7 absolute top-2 right-2"
                    onClick={() => copyToClipboard(mcpConfig)}
                  >
                    <CopyIcon className="size-3" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="documents" className="flex-1">
        <TabsList className="grid grid-cols-3 w-full max-w-sm">
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="playground">Playground</TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="mt-4">
          <KnowledgeDocumentsTab
            groupId={group.id}
            initialDocuments={initialDocuments}
          />
        </TabsContent>

        <TabsContent value="usage" className="mt-4">
          <KnowledgeUsageTab groupId={group.id} />
        </TabsContent>

        <TabsContent value="playground" className="mt-4">
          <KnowledgePlaygroundTab groupId={group.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
