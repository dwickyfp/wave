"use client";

import { mutateKnowledge } from "@/hooks/queries/use-knowledge";
import { useKnowledgeModels } from "@/hooks/queries/use-knowledge-models";
import { KnowledgeDocument, KnowledgeGroup } from "app-types/knowledge";
import { format } from "date-fns";
import { cn } from "lib/utils";
import {
  BrainIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronUpIcon,
  CopyIcon,
  KeyIcon,
  RefreshCwIcon,
  SaveIcon,
  ServerIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Label } from "ui/label";
import { Switch } from "ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/tabs";
import { KnowledgeDocumentsTab } from "./knowledge-documents-tab";
import {
  ModelSelector,
  NONE_VALUE,
  makeModelValue,
  parseModelValue,
} from "./knowledge-model-selector";
import { KnowledgePlaygroundTab } from "./knowledge-playground-tab";
import { KnowledgeUsageTab } from "./knowledge-usage-tab";

interface Props {
  group: KnowledgeGroup;
  initialDocuments: KnowledgeDocument[];
  userId: string;
  contextxModel: { provider: string; model: string } | null;
}

export function KnowledgeDetailPage({
  group,
  initialDocuments,
  userId,
  contextxModel,
}: Props) {
  const isOwner = group.userId === userId;
  const { data: modelsData } = useKnowledgeModels();

  const initialEmbeddingValue = makeModelValue(
    group.embeddingProvider,
    group.embeddingModel,
  );
  const initialRerankingValue =
    group.rerankingProvider && group.rerankingModel
      ? makeModelValue(group.rerankingProvider, group.rerankingModel)
      : NONE_VALUE;

  // ── Settings section state ───────────────────────────────────────────────
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [threshold, setThreshold] = useState(group.retrievalThreshold ?? 0);
  const [embeddingValue, setEmbeddingValue] = useState(initialEmbeddingValue);
  const [rerankingValue, setRerankingValue] = useState(initialRerankingValue);
  const [savedThreshold, setSavedThreshold] = useState(
    group.retrievalThreshold ?? 0,
  );
  const [savedEmbeddingValue, setSavedEmbeddingValue] = useState(
    initialEmbeddingValue,
  );
  const [savedRerankingValue, setSavedRerankingValue] = useState(
    initialRerankingValue,
  );

  const savedEmbedding = parseModelValue(savedEmbeddingValue) ?? {
    provider: group.embeddingProvider,
    apiName: group.embeddingModel,
  };
  const savedReranking = parseModelValue(savedRerankingValue);
  const hasSettingsChanges =
    threshold !== savedThreshold ||
    embeddingValue !== savedEmbeddingValue ||
    rerankingValue !== savedRerankingValue;

  const handleSaveSettings = async () => {
    const embedding = parseModelValue(embeddingValue);
    if (!embedding) {
      toast.error("Please select an embedding model");
      return;
    }

    const reranking = parseModelValue(rerankingValue);
    const embeddingChanged = embeddingValue !== savedEmbeddingValue;

    setSavingSettings(true);
    try {
      const res = await fetch(`/api/knowledge/${group.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          retrievalThreshold: threshold,
          embeddingProvider: embedding.provider,
          embeddingModel: embedding.apiName,
          rerankingProvider: reranking?.provider ?? null,
          rerankingModel: reranking?.apiName ?? null,
        }),
      });
      if (!res.ok) throw new Error();
      setSavedThreshold(threshold);
      setSavedEmbeddingValue(embeddingValue);
      setSavedRerankingValue(rerankingValue);
      void mutateKnowledge();
      toast.success(
        embeddingChanged
          ? "Settings saved. Re-embed documents to apply new embeddings."
          : "Settings saved",
      );
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  };

  // ── MCP section state ────────────────────────────────────────────────────
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
                {savedEmbedding.provider}/{savedEmbedding.apiName}
              </Badge>
              {savedReranking && (
                <Badge variant="secondary" className="text-xs">
                  rerank: {savedReranking.provider}/{savedReranking.apiName}
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

      {/* Settings Section (owner only) */}
      {isOwner && (
        <div className="border rounded-xl overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors"
            onClick={() => setSettingsOpen((o) => !o)}
          >
            <div className="flex items-center gap-2">
              <SlidersHorizontalIcon className="size-4 text-primary" />
              <span className="text-sm font-medium">Settings</span>
              {contextxModel && (
                <Badge variant="secondary" className="text-xs px-1.5 py-0">
                  LLM: {contextxModel.model}
                </Badge>
              )}
              {savedThreshold > 0 && (
                <Badge variant="secondary" className="text-xs px-1.5 py-0">
                  threshold: {savedThreshold.toFixed(2)}
                </Badge>
              )}
            </div>
            {settingsOpen ? (
              <ChevronUpIcon className="size-4" />
            ) : (
              <ChevronDownIcon className="size-4" />
            )}
          </button>

          {settingsOpen && (
            <div className="px-4 pb-4 flex flex-col gap-4 border-t">
              {/* Parsing LLM — global setting (read-only) */}
              <div className="flex flex-col gap-1.5 pt-3">
                <Label className="text-sm font-medium">Parsing LLM</Label>
                {contextxModel ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono bg-secondary/50 border rounded px-2 py-1">
                      {contextxModel.provider}/{contextxModel.model}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-amber-600">
                    No ContextX model configured. Set one in Settings → ContextX
                    Model to enable document parsing.
                  </p>
                )}
              </div>

              {/* Retrieval Models */}
              <div className="flex flex-col gap-3 rounded-lg border p-3 bg-muted/30">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-sm font-medium">Embedding Model</Label>
                  <ModelSelector
                    value={embeddingValue}
                    onValueChange={setEmbeddingValue}
                    providers={modelsData?.embeddingProviders ?? []}
                    placeholder="Select embedding model"
                  />
                  <p className="text-xs text-muted-foreground">
                    Used when documents are chunked and when semantic retrieval
                    runs.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-sm font-medium">Reranking Model</Label>
                  <ModelSelector
                    value={rerankingValue}
                    onValueChange={setRerankingValue}
                    providers={modelsData?.rerankingProviders ?? []}
                    placeholder="Select reranking model"
                    allowNone
                    noneLabel="No reranker"
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional second-pass ranking after hybrid search.
                  </p>
                </div>
              </div>

              {/* Retrieval Threshold */}
              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium">
                  Retrieval Threshold
                </Label>
                <p className="text-xs text-muted-foreground">
                  Minimum relevance score (0–1) for a result to be returned. Set
                  to 0 to disable filtering.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    className="flex-1 h-1.5 accent-primary"
                  />
                  <span className="text-sm font-mono w-10 text-right">
                    {threshold.toFixed(2)}
                  </span>
                </div>
              </div>

              <Button
                size="sm"
                className="self-end gap-1.5"
                onClick={handleSaveSettings}
                disabled={savingSettings || !hasSettingsChanges}
              >
                {savingSettings ? (
                  <RefreshCwIcon className="size-3.5 animate-spin" />
                ) : (
                  <SaveIcon className="size-3.5" />
                )}
                Save Settings
              </Button>
            </div>
          )}
        </div>
      )}

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
            uploadDisabledMessage={
              !contextxModel
                ? "Configure a ContextX Model in Settings before uploading documents."
                : undefined
            }
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
