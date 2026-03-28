"use client";

import { appStore } from "@/app/store";
import type { ChatKnowledgeSource } from "app-types/chat";
import { cn } from "lib/utils";
import { ArrowUpRightIcon, LibraryBigIcon } from "lucide-react";
import { useState } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "ui/hover-card";
import { ScrollArea } from "ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

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
      <HoverCardContent
        side="top"
        align="start"
        className="w-[min(28rem,calc(100vw-2rem))] p-0"
      >
        <div className="border-b px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <LibraryBigIcon className="size-4 text-primary" />
            Knowledge Sources
          </div>
        </div>

        <ScrollArea className={sources.length > 6 ? "h-72" : "max-h-72"}>
          <div className="p-3">
            {sources.map((source) => (
              <Tooltip key={`${source.groupId}-${source.documentId}`}>
                <TooltipTrigger asChild>
                  <button
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
                    className="group flex w-full items-center overflow-hidden rounded-xl border border-transparent px-3 py-3 text-left transition-colors hover:border-border/60 hover:bg-muted/50"
                  >
                    <span className="mr-3 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                      {getSourceInitials(source.documentName)}
                    </span>
                    <span
                      className="mr-3 truncate text-sm font-medium text-foreground"
                      title={source.documentName}
                    >
                      {source.documentName.length > 50
                        ? source.documentName.slice(0, 40) + "…"
                        : source.documentName}
                    </span>
                    <ArrowUpRightIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" align="start">
                  {source.documentName}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </ScrollArea>
      </HoverCardContent>
    </HoverCard>
  );
}
