"use client";

import { useState, useRef, useMemo } from "react";
import { KnowledgeQueryResult } from "app-types/knowledge";
import { Button } from "ui/button";
import { Textarea } from "ui/textarea";
import { Badge } from "ui/badge";
import { Skeleton } from "ui/skeleton";
import { Label } from "ui/label";
import { Input } from "ui/input";
import {
  SearchIcon,
  FileTextIcon,
  ZapIcon,
  SlidersHorizontalIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FileIcon,
  HashIcon,
  BookOpenIcon,
  LayersIcon,
} from "lucide-react";
import { cn } from "lib/utils";
import { toast } from "sonner";

interface Props {
  groupId: string;
}

// ─── Types ──────────────────────────────────────────────────────────────────────

interface DocRetrievalResult {
  documentId: string;
  documentName: string;
  relevanceScore: number;
  chunkHits: number;
  markdown: string;
}

type ViewMode = "docs" | "chunks";

// ─── Score Badge ────────────────────────────────────────────────────────────────

function ScoreBadge({ score, label }: { score: number; label?: string }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 80
      ? "bg-green-500/10 text-green-600 border-green-500/30"
      : pct >= 55
        ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
        : "bg-red-500/10 text-red-500 border-red-500/30";
  return (
    <Badge
      variant="outline"
      className={cn("text-xs font-mono px-1.5 py-0", color)}
    >
      {label ? `${label} ` : ""}
      {pct}%
    </Badge>
  );
}

// ─── Document Card (Context7-style) ─────────────────────────────────────────────

function DocumentCard({
  doc,
  index,
}: {
  doc: DocRetrievalResult;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const previewLength = 800;
  const isLong = doc.markdown.length > previewLength;
  const preview =
    isLong && !expanded
      ? doc.markdown.slice(0, previewLength) + "…"
      : doc.markdown;
  const estimatedTokens = Math.ceil(doc.markdown.length / 4);

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/30">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex items-center justify-center size-6 rounded-full bg-primary/10 text-primary text-xs font-semibold shrink-0">
            {index + 1}
          </span>
          <FileTextIcon className="size-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">
            {doc.documentName}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge
            variant="outline"
            className="text-xs font-mono px-1.5 py-0 bg-blue-500/10 text-blue-600 border-blue-500/30"
          >
            {doc.chunkHits} chunk hits
          </Badge>
          <Badge
            variant="outline"
            className="text-xs font-mono px-1.5 py-0 bg-purple-500/10 text-purple-600 border-purple-500/30"
          >
            score {doc.relevanceScore.toFixed(3)}
          </Badge>
        </div>
      </div>

      {/* Markdown content */}
      <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words font-mono bg-secondary/30 rounded-lg p-3 max-h-[600px] overflow-y-auto">
        {preview}
      </div>

      {isLong && (
        <button
          className="flex items-center gap-1 text-xs text-primary hover:underline self-start"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? (
            <>
              <ChevronUpIcon className="size-3" /> Collapse
            </>
          ) : (
            <>
              <ChevronDownIcon className="size-3" /> Show full document
            </>
          )}
        </button>
      )}

      {/* Footer */}
      <div className="flex items-center gap-3 pt-1 border-t border-border/50 mt-1">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <ZapIcon className="size-3" />~{estimatedTokens.toLocaleString()}{" "}
          tokens
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <FileTextIcon className="size-3" />
          {(doc.markdown.length / 1024).toFixed(1)} KB
        </span>
      </div>
    </div>
  );
}

// ─── Chunk Card (debug view) ────────────────────────────────────────────────────

function ChunkCard({
  result,
  index,
}: {
  result: KnowledgeQueryResult;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const content = result.chunk.content;
  const isLong = content.length > 320;
  const preview = isLong && !expanded ? content.slice(0, 320) + "…" : content;

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/30">
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex items-center justify-center size-5 rounded-full bg-primary/10 text-primary text-xs font-semibold shrink-0">
            {index + 1}
          </span>
          <FileIcon className="size-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground truncate font-medium">
            {result.documentName}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {result.rerankScore !== undefined && (
            <Badge
              variant="outline"
              className="text-xs font-mono px-1.5 py-0 bg-purple-500/10 text-purple-600 border-purple-500/30"
            >
              rerank {Math.round(result.rerankScore * 100)}%
            </Badge>
          )}
          <ScoreBadge score={result.score} />
        </div>
      </div>

      {/* Metadata row */}
      {(result.chunk.metadata?.section ||
        result.chunk.metadata?.pageNumber ||
        result.chunk.metadata?.sheetName) && (
        <div className="flex items-center gap-2 flex-wrap">
          {result.chunk.metadata.section && (
            <span className="text-xs text-muted-foreground bg-secondary/50 rounded px-1.5 py-0.5">
              {result.chunk.metadata.section}
            </span>
          )}
          {result.chunk.metadata.pageNumber && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <HashIcon className="size-3" />
              page {result.chunk.metadata.pageNumber}
            </span>
          )}
          {result.chunk.metadata.sheetName && (
            <span className="text-xs text-muted-foreground bg-secondary/50 rounded px-1.5 py-0.5">
              {result.chunk.metadata.sheetName}
            </span>
          )}
        </div>
      )}

      {/* Context summary */}
      {result.chunk.contextSummary && (
        <p className="text-xs text-muted-foreground italic border-l-2 border-primary/30 pl-2">
          {result.chunk.contextSummary}
        </p>
      )}

      {/* Content */}
      <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words">
        {preview}
      </p>

      {isLong && (
        <button
          className="flex items-center gap-1 text-xs text-primary hover:underline self-start mt-0.5"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? (
            <>
              <ChevronUpIcon className="size-3" /> Show less
            </>
          ) : (
            <>
              <ChevronDownIcon className="size-3" /> Show more
            </>
          )}
        </button>
      )}

      {/* Footer */}
      <div className="flex items-center gap-3 pt-1 border-t border-border/50 mt-1">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <ZapIcon className="size-3" />
          {result.chunk.tokenCount} tokens
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <FileTextIcon className="size-3" />
          chunk #{result.chunk.chunkIndex}
        </span>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export function KnowledgePlaygroundTab({ groupId }: Props) {
  const [query, setQuery] = useState("");
  const [tokens, setTokens] = useState(10000);
  const [topN, setTopN] = useState(5);
  const [viewMode, setViewMode] = useState<ViewMode>("docs");

  // Doc results
  const [docResults, setDocResults] = useState<DocRetrievalResult[] | null>(
    null,
  );
  // Chunk results (debug mode)
  const [chunkResults, setChunkResults] = useState<
    KnowledgeQueryResult[] | null
  >(null);

  const [loading, setLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) {
      toast.error("Enter a query to search");
      return;
    }
    setLoading(true);
    setDocResults(null);
    setChunkResults(null);
    const t0 = performance.now();

    try {
      if (viewMode === "docs") {
        const res = await fetch(`/api/knowledge/${groupId}/docs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, tokens }),
        });
        if (!res.ok) throw new Error("Query failed");
        const data = await res.json();
        setDocResults(Array.isArray(data) ? data : []);
      } else {
        const res = await fetch(`/api/knowledge/${groupId}/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, topN }),
        });
        if (!res.ok) throw new Error("Query failed");
        const data: KnowledgeQueryResult[] = await res.json();
        setChunkResults(data);
      }
      setElapsedMs(Math.round(performance.now() - t0));
    } catch {
      toast.error("Failed to query knowledge group");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSearch();
    }
  };

  const totalDocTokens = useMemo(
    () =>
      Array.isArray(docResults)
        ? docResults.reduce(
            (sum, d) => sum + Math.ceil(d.markdown.length / 4),
            0,
          )
        : undefined,
    [docResults],
  );

  const hasResults =
    viewMode === "docs" ? docResults !== null : chunkResults !== null;
  const isEmpty =
    viewMode === "docs"
      ? docResults !== null && docResults.length === 0
      : chunkResults !== null && chunkResults.length === 0;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start h-full min-h-0">
      {/* ── Left panel: Query input ── */}
      <div className="flex flex-col gap-3 w-full lg:w-80 xl:w-96 shrink-0">
        <div className="flex flex-col gap-1">
          <Label className="text-sm font-medium">Query</Label>
          <p className="text-xs text-muted-foreground">
            Enter a question to retrieve relevant documents.
          </p>
        </div>

        <Textarea
          ref={textareaRef}
          placeholder="e.g. What are the refund policy conditions?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="min-h-[140px] resize-none text-sm leading-relaxed"
        />

        {/* View mode toggle */}
        <div className="flex items-center gap-1 rounded-lg border bg-secondary/50 p-0.5">
          <button
            className={cn(
              "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors flex-1 justify-center",
              viewMode === "docs"
                ? "bg-background text-foreground shadow-sm font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setViewMode("docs")}
          >
            <BookOpenIcon className="size-3.5" />
            Full Docs
          </button>
          <button
            className={cn(
              "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors flex-1 justify-center",
              viewMode === "chunks"
                ? "bg-background text-foreground shadow-sm font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setViewMode("chunks")}
          >
            <LayersIcon className="size-3.5" />
            Chunks
          </button>
        </div>

        {/* Settings toggle */}
        <button
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors self-start"
          onClick={() => setShowSettings((s) => !s)}
        >
          <SlidersHorizontalIcon className="size-3.5" />
          Settings
          {showSettings ? (
            <ChevronUpIcon className="size-3" />
          ) : (
            <ChevronDownIcon className="size-3" />
          )}
        </button>

        {showSettings && (
          <div className="flex flex-col gap-3 rounded-lg border bg-secondary/30 p-3">
            {viewMode === "docs" ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Token budget</Label>
                </div>
                <Input
                  type="number"
                  min={500}
                  max={50000}
                  step={500}
                  value={tokens}
                  onChange={(e) =>
                    setTokens(
                      Math.max(500, Math.min(50000, Number(e.target.value))),
                    )
                  }
                  className="h-7 text-xs w-28"
                />
                <p className="text-xs text-muted-foreground">
                  Max tokens of full-doc content to return (500–50000)
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Top N chunks</Label>
                </div>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={topN}
                  onChange={(e) =>
                    setTopN(Math.max(1, Math.min(20, Number(e.target.value))))
                  }
                  className="h-7 text-xs w-24"
                />
                <p className="text-xs text-muted-foreground">
                  Max chunks to retrieve (1–20)
                </p>
              </div>
            )}
          </div>
        )}

        <Button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="w-full gap-2"
        >
          {loading ? (
            <>
              <SearchIcon className="size-4 animate-pulse" />
              Searching…
            </>
          ) : (
            <>
              <SearchIcon className="size-4" />
              Search
              <span className="text-xs opacity-60 ml-auto hidden sm:block">
                ⌘↵
              </span>
            </>
          )}
        </Button>

        {/* Hint */}
        {!hasResults && !loading && (
          <p className="text-xs text-muted-foreground text-center pt-2">
            Results will appear on the right
          </p>
        )}
      </div>

      {/* ── Divider ── */}
      <div className="hidden lg:block w-px bg-border self-stretch" />
      <div className="block lg:hidden h-px bg-border" />

      {/* ── Right panel: Results ── */}
      <div className="flex flex-col gap-3 flex-1 min-w-0">
        {/* Header bar */}
        <div className="flex items-center justify-between h-5">
          {hasResults && !loading && (
            <>
              <span className="text-sm font-medium">
                {viewMode === "docs" ? (
                  <>
                    {docResults!.length} document
                    {docResults!.length !== 1 ? "s" : ""} found
                    {totalDocTokens !== undefined && (
                      <span className="text-xs text-muted-foreground font-normal ml-2">
                        (~{totalDocTokens.toLocaleString()} tokens)
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    {chunkResults!.length} chunk
                    {chunkResults!.length !== 1 ? "s" : ""} found
                  </>
                )}
              </span>
              {elapsedMs !== null && (
                <span className="text-xs text-muted-foreground">
                  {elapsedMs} ms
                </span>
              )}
            </>
          )}
          {loading && (
            <span className="text-sm text-muted-foreground">Searching…</span>
          )}
        </div>

        {/* Loading skeletons */}
        {loading && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        )}

        {/* Empty state before first search */}
        {!loading && !hasResults && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center text-muted-foreground gap-2">
            <SearchIcon className="size-8 opacity-30" />
            <p className="text-sm">
              Run a query to see matching{" "}
              {viewMode === "docs" ? "documents" : "chunks"} here
            </p>
            <p className="text-xs opacity-60">
              {viewMode === "docs"
                ? "Documents are ranked by semantic similarity using embedding + BM25 + reranking"
                : "Chunks are ranked by semantic similarity score"}
            </p>
          </div>
        )}

        {/* No results */}
        {!loading && isEmpty && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center text-muted-foreground gap-2">
            <FileTextIcon className="size-8 opacity-30" />
            <p className="text-sm">
              No {viewMode === "docs" ? "documents" : "chunks"} matched your
              query
            </p>
            <p className="text-xs opacity-60">
              Try rephrasing your question or uploading more documents
            </p>
          </div>
        )}

        {/* Doc cards (Context7-style) */}
        {!loading &&
          viewMode === "docs" &&
          docResults &&
          docResults.length > 0 && (
            <div className="flex flex-col gap-3">
              {docResults.map((d, i) => (
                <DocumentCard key={d.documentId} doc={d} index={i} />
              ))}
            </div>
          )}

        {/* Chunk cards (debug view) */}
        {!loading &&
          viewMode === "chunks" &&
          chunkResults &&
          chunkResults.length > 0 && (
            <div className="flex flex-col gap-3">
              {chunkResults.map((r, i) => (
                <ChunkCard key={r.chunk.id} result={r} index={i} />
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
