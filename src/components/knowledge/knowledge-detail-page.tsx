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
import { useEffect, useState } from "react";
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

type McpToolParam = {
  name: string;
  required?: boolean;
  description: string;
};

type McpToolDoc = {
  name: string;
  label?: string;
  description: string;
  params: McpToolParam[];
  kind?: "primary" | "legacy" | "utility";
};

type StoredMcpApiKey = {
  key: string;
  preview?: string;
  createdAt?: number;
};

const MCP_TOOL_DOCS: McpToolDoc[] = [
  {
    name: "resolve-library-id",
    kind: "primary",
    description:
      "Resolves a library/package name into a ContextX-compatible library ID.",
    params: [
      {
        name: "query",
        required: true,
        description:
          "User question/task. Used to rank the most relevant library ID.",
      },
      {
        name: "libraryName",
        required: true,
        description:
          'Library name to resolve (example: "next.js", "react", "mongodb").',
      },
      {
        name: "topK",
        required: false,
        description: "How many candidate IDs to return (default: 5).",
      },
    ],
  },
  {
    name: "query-docs",
    kind: "primary",
    description:
      "Retrieves relevant documentation sections for a resolved library ID.",
    params: [
      {
        name: "libraryId",
        required: true,
        description:
          'Resolved library ID (example: "/vercel/next.js", "/mongodb/docs").',
      },
      {
        name: "query",
        required: true,
        description: "Question/task to retrieve relevant documentation for.",
      },
      {
        name: "version",
        required: false,
        description: "Optional version filter (example: 14, 5.2.1).",
      },
      {
        name: "tokens",
        required: false,
        description: "Token budget for response (default: 10000).",
      },
      {
        name: "maxDocs",
        required: false,
        description: "Maximum documents returned (default: 8).",
      },
    ],
  },
  {
    name: "get_docs",
    label: "get_docs (legacy)",
    kind: "legacy",
    description:
      "Legacy full-doc retrieval tool. Kept for backward compatibility.",
    params: [
      {
        name: "query",
        required: true,
        description: "Search query.",
      },
      {
        name: "tokens",
        required: false,
        description: "Token budget for response (default: 10000).",
      },
    ],
  },
  {
    name: "list_documents",
    kind: "utility",
    description: "Lists all documents available in this knowledge group.",
    params: [],
  },
];

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
  const mcpLocalStorageKey = `contextx:mcp-api-key:${group.id}`;

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const mcpUrl = `${baseUrl}/api/mcp/knowledge/${group.id}`;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const removeStored = () => {
      localStorage.removeItem(mcpLocalStorageKey);
    };

    try {
      const raw = localStorage.getItem(mcpLocalStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredMcpApiKey;
      if (!parsed?.key) {
        removeStored();
        return;
      }

      const storedPreview = parsed.preview || parsed.key.slice(-4);
      const serverPreview = group.mcpApiKeyPreview || null;

      // If server no longer has key preview (e.g. revoked), drop local copy.
      if (!serverPreview) {
        removeStored();
        return;
      }

      // If server preview changed (new key generated elsewhere), invalidate stale local key.
      if (storedPreview !== serverPreview) {
        removeStored();
        return;
      }

      setApiKey(parsed.key);
      setKeyPreview(serverPreview);
    } catch {
      removeStored();
    }
  }, [group.mcpApiKeyPreview, mcpLocalStorageKey]);

  const handleGenerateKey = async () => {
    setGeneratingKey(true);
    try {
      const res = await fetch(`/api/knowledge/${group.id}/mcp-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });
      if (!res.ok) {
        throw new Error("Failed to generate API key");
      }
      const data = await res.json();
      setApiKey(data.key);
      setKeyPreview(data.preview);
      if (data?.key) {
        try {
          localStorage.setItem(
            mcpLocalStorageKey,
            JSON.stringify({
              key: data.key,
              preview: data.preview,
              createdAt: Date.now(),
            } satisfies StoredMcpApiKey),
          );
        } catch {
          toast.warning(
            "API key generated, but could not persist it in this browser",
          );
        }
      }
      toast.success("API key generated and saved in this browser");
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
      headers: { CONTEXTX_API_KEY: apiKey ?? "YOUR_API_KEY" },
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
                    This key is saved in this browser for this knowledge group.
                    Clear browser/site data will remove it.
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

              {/* Available tools */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Available Tools</Label>
                  <div className="flex items-center gap-1">
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 bg-blue-500/10 text-blue-600 border-blue-500/30"
                    >
                      Primary
                    </Badge>
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 bg-amber-500/10 text-amber-600 border-amber-500/30"
                    >
                      Legacy
                    </Badge>
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
                    >
                      Utility
                    </Badge>
                  </div>
                </div>
                <div className="rounded-lg border bg-secondary/20 p-3 space-y-3">
                  <div className="rounded-md border bg-background/40 p-2.5">
                    <p className="text-xs text-muted-foreground">
                      Recommended flow:
                      <span className="font-mono rounded bg-secondary px-1.5 py-0.5 mx-1 text-foreground">
                        resolve-library-id
                      </span>
                      →
                      <span className="font-mono rounded bg-secondary px-1.5 py-0.5 mx-1 text-foreground">
                        query-docs
                      </span>
                    </p>
                  </div>

                  {MCP_TOOL_DOCS.map((tool) => {
                    const requiredParams = tool.params.filter(
                      (p) => p.required,
                    );
                    const optionalParams = tool.params.filter(
                      (p) => !p.required,
                    );
                    const orderedParams = [
                      ...requiredParams,
                      ...optionalParams,
                    ];

                    return (
                      <div
                        key={tool.name}
                        className="rounded-md border bg-background/40 p-3 space-y-2.5"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs rounded bg-secondary px-2 py-1">
                            {tool.label ?? tool.name}
                          </span>

                          {tool.kind === "primary" && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 bg-blue-500/10 text-blue-600 border-blue-500/30"
                            >
                              Primary
                            </Badge>
                          )}
                          {tool.kind === "legacy" && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 bg-amber-500/10 text-amber-600 border-amber-500/30"
                            >
                              Legacy
                            </Badge>
                          )}
                          {tool.kind === "utility" && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
                            >
                              Utility
                            </Badge>
                          )}

                          {tool.params.length > 0 && (
                            <>
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                              >
                                {requiredParams.length} required
                              </Badge>
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
                              >
                                {optionalParams.length} optional
                              </Badge>
                            </>
                          )}
                        </div>

                        <div className="space-y-1">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Function
                          </p>
                          <p className="text-xs text-foreground/90">
                            {tool.description}
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Parameters
                          </p>
                          {orderedParams.length > 0 ? (
                            <div className="overflow-x-auto rounded-md border bg-background/30">
                              <table className="w-full text-xs">
                                <thead className="bg-secondary/40 text-muted-foreground">
                                  <tr>
                                    <th className="text-left font-medium px-2.5 py-2 w-[160px]">
                                      Name
                                    </th>
                                    <th className="text-left font-medium px-2.5 py-2 w-[90px]">
                                      Required
                                    </th>
                                    <th className="text-left font-medium px-2.5 py-2">
                                      Description
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {orderedParams.map((param) => (
                                    <tr
                                      key={`${tool.name}:${param.name}`}
                                      className="border-t border-border/60 align-top"
                                    >
                                      <td className="px-2.5 py-2">
                                        <span className="font-mono rounded bg-secondary px-1.5 py-0.5">
                                          {param.name}
                                        </span>
                                      </td>
                                      <td className="px-2.5 py-2">
                                        {param.required ? (
                                          <Badge
                                            variant="outline"
                                            className="text-[10px] px-1.5 py-0 bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                                          >
                                            Yes
                                          </Badge>
                                        ) : (
                                          <Badge
                                            variant="outline"
                                            className="text-[10px] px-1.5 py-0 bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
                                          >
                                            No
                                          </Badge>
                                        )}
                                      </td>
                                      <td className="px-2.5 py-2 text-muted-foreground">
                                        {param.description}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              No parameters.
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
