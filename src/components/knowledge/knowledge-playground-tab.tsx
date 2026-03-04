"use client";

import { useState, useRef } from "react";
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
} from "lucide-react";
import { cn } from "lib/utils";
import { toast } from "sonner";

interface Props {
  groupId: string;
}

function ScoreBadge({ score }: { score: number }) {
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
      {pct}%
    </Badge>
  );
}

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

export function KnowledgePlaygroundTab({ groupId }: Props) {
  const [query, setQuery] = useState("");
  const [topN, setTopN] = useState(5);
  const [results, setResults] = useState<KnowledgeQueryResult[] | null>(null);
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
    setResults(null);
    const t0 = performance.now();
    try {
      const res = await fetch(`/api/knowledge/${groupId}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, topN }),
      });
      if (!res.ok) throw new Error("Query failed");
      const data: KnowledgeQueryResult[] = await res.json();
      setResults(data);
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

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start h-full min-h-0">
      {/* ── Left panel: Query input ── */}
      <div className="flex flex-col gap-3 w-full lg:w-80 xl:w-96 shrink-0">
        <div className="flex flex-col gap-1">
          <Label className="text-sm font-medium">Query</Label>
          <p className="text-xs text-muted-foreground">
            Enter a natural-language question to retrieve relevant chunks.
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
        {results === null && !loading && (
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
          {results !== null && (
            <>
              <span className="text-sm font-medium">
                {results.length} chunk{results.length !== 1 ? "s" : ""} found
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
            {Array.from({ length: topN > 5 ? 5 : topN }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        )}

        {/* Empty state before first search */}
        {!loading && results === null && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center text-muted-foreground gap-2">
            <SearchIcon className="size-8 opacity-30" />
            <p className="text-sm">Run a query to see matching chunks here</p>
            <p className="text-xs opacity-60">
              Chunks are ranked by semantic similarity score
            </p>
          </div>
        )}

        {/* No results */}
        {!loading && results !== null && results.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center text-muted-foreground gap-2">
            <FileTextIcon className="size-8 opacity-30" />
            <p className="text-sm">No chunks matched your query</p>
            <p className="text-xs opacity-60">
              Try rephrasing your question or uploading more documents
            </p>
          </div>
        )}

        {/* Chunk cards */}
        {!loading && results && results.length > 0 && (
          <div className="flex flex-col gap-3">
            {results.map((r, i) => (
              <ChunkCard key={r.chunk.id} result={r} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
