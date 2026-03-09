"use client";

import { useState } from "react";
import { appStore } from "@/app/store";
import type { ChatKnowledgeSource } from "app-types/chat";
import { cn } from "lib/utils";
import { ArrowUpRightIcon, LibraryBigIcon } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "ui/hover-card";
import { ScrollArea } from "ui/scroll-area";

function getSourceInitials(name: string): string {
  const cleaned = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((segment) => segment[0]?.toUpperCase())
    .join("");

  return cleaned || "K";
}

export function KnowledgeSourcesBadge({
  sources,
}: {
  sources: ChatKnowledgeSource[];
}) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;

  const previewSources = sources.slice(0, 3);
  const label = `${sources.length} ${sources.length === 1 ? "Source" : "Sources"}`;

  return (
    <HoverCard
      open={open}
      onOpenChange={setOpen}
      openDelay={120}
      closeDelay={80}
    >
      <HoverCardTrigger asChild>
        <button
          type="button"
          data-testid="message-knowledge-sources-badge"
          className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
        >
          <div className="flex items-center">
            {previewSources.map((source, index) => (
              <span
                key={`${source.groupId}-${source.documentId}`}
                className={cn(
                  "flex size-5 items-center justify-center rounded-full border border-background bg-muted text-[10px] font-semibold text-foreground shadow-sm",
                  index > 0 && "-ml-2",
                )}
              >
                {getSourceInitials(source.documentName)}
              </span>
            ))}
          </div>
          <span className="font-medium">{label}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <LibraryBigIcon className="size-4 text-primary" />
            Knowledge sources
          </div>
        </div>

        <ScrollArea className={sources.length > 6 ? "h-72" : "max-h-72"}>
          <div className="p-2">
            {sources.map((source) => (
              <button
                key={`${source.groupId}-${source.documentId}`}
                type="button"
                onClick={() => {
                  appStore.setState({
                    citationDocumentPreview: {
                      documentId: source.documentId,
                      groupId: source.groupId,
                      documentName: source.documentName,
                    },
                  });
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted/70"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                  {getSourceInitials(source.documentName)}
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
                  title={source.documentName}
                >
                  {source.documentName}
                </span>
                <ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </ScrollArea>
      </HoverCardContent>
    </HoverCard>
  );
}
