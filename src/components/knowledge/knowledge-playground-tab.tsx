"use client";

import {
  ChevronDownIcon,
  ChevronUpIcon,
  FileTextIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  ZapIcon,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Skeleton } from "ui/skeleton";
import { Textarea } from "ui/textarea";

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
  matchedSections?: Array<{
    heading: string;
    score: number;
  }>;
}

// ─── Document Card ──────────────────────────────────────────────────────────────

function DocumentCard({
  doc,
  index,
}: {
  doc: DocRetrievalResult;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const uniqueMatchedSections = doc.matchedSections
    ? Array.from(
        new Map(
          doc.matchedSections.map((section) => [section.heading, section]),
        ).values(),
      ).slice(0, 4)
    : [];
  const previewLength = 1200;
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
            {doc.chunkHits} relevant chunks
          </Badge>
          <Badge
            variant="outline"
            className="text-xs font-mono px-1.5 py-0 bg-purple-500/10 text-purple-600 border-purple-500/30"
          >
            score {doc.relevanceScore.toFixed(3)}
          </Badge>
        </div>
      </div>

      {uniqueMatchedSections.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {uniqueMatchedSections.map((section, sectionIndex) => (
            <Badge
              key={`${doc.documentId}:${section.heading}:${sectionIndex}`}
              variant="outline"
              className="text-[11px] px-1.5 py-0 bg-emerald-500/10 text-emerald-600 border-emerald-500/30 max-w-full truncate"
              title={section.heading}
            >
              {section.heading}
            </Badge>
          ))}
        </div>
      )}

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
              <ChevronDownIcon className="size-3" /> Show more
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

// ─── Main Component ─────────────────────────────────────────────────────────────

export function KnowledgePlaygroundTab({ groupId }: Props) {
  const [query, setQuery] = useState("");
  const [tokens, setTokens] = useState(10000);
  const [docResults, setDocResults] = useState<DocRetrievalResult[] | null>(
    null,
  );
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
    const t0 = performance.now();
    try {
      const res = await fetch(`/api/knowledge/${groupId}/docs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, tokens }),
      });
      if (!res.ok) throw new Error("Query failed");
      const data = await res.json();
      setDocResults(Array.isArray(data) ? data : []);
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

  const hasResults = docResults !== null;
  const isEmpty = docResults !== null && docResults.length === 0;

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
          <div className="flex flex-col gap-2 rounded-lg border bg-secondary/30 p-3">
            <Label className="text-xs font-medium">Token budget</Label>
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
              Max tokens of relevant section snippets to return (500–50000)
            </p>
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
                {docResults!.length} document
                {docResults!.length !== 1 ? "s" : ""} with relevant sections
                {totalDocTokens !== undefined && (
                  <span className="text-xs text-muted-foreground font-normal ml-2">
                    (~{totalDocTokens.toLocaleString()} tokens)
                  </span>
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
              Run a query to see matching documents here
            </p>
            <p className="text-xs opacity-60">
              Results show only relevant sections (heading + matched content)
              using hybrid retrieval
            </p>
          </div>
        )}

        {/* No results */}
        {!loading && isEmpty && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center text-muted-foreground gap-2">
            <FileTextIcon className="size-8 opacity-30" />
            <p className="text-sm">No relevant sections matched your query</p>
            <p className="text-xs opacity-60">
              Try rephrasing your question or uploading more documents
            </p>
          </div>
        )}

        {/* Document cards */}
        {!loading && docResults && docResults.length > 0 && (
          <div className="flex flex-col gap-3">
            {docResults.map((d, i) => (
              <DocumentCard key={d.documentId} doc={d} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
