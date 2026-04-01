"use client";

import { appStore } from "@/app/store";
import type { ChatKnowledgeImage } from "app-types/chat";
import { ImageIcon, MapPinnedIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

export function KnowledgeImageGallery({
  images,
}: {
  images: ChatKnowledgeImage[];
}) {
  if (!images.length) return null;

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-background/60 p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <ImageIcon className="size-3.5" />
        Related Images
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {images.map((image) => {
          const documentLabel =
            image.headingPath || image.stepHint || image.documentName;

          return (
            <button
              key={`${image.documentId}:${image.imageId}:${image.versionId ?? "live"}`}
              type="button"
              className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/60 p-2 text-left transition-colors hover:border-primary/30 hover:bg-accent/40"
              onClick={() => {
                appStore.setState({
                  citationDocumentPreview: {
                    documentId: image.documentId,
                    groupId: image.groupId,
                    documentName: image.documentName,
                    imageId: image.imageId,
                    versionId: image.versionId ?? null,
                  },
                });
              }}
            >
              <div className="flex h-20 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                {image.assetUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={image.assetUrl}
                    alt={image.label}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImageIcon className="size-5 text-muted-foreground" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {image.label}
                </div>
                <div className="line-clamp-2 text-xs text-muted-foreground">
                  {image.description}
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="mt-2 flex max-w-full items-center gap-1 text-[11px] text-muted-foreground">
                      <MapPinnedIcon className="size-3 shrink-0" />
                      <span className="truncate" title={image.documentName}>
                        {documentLabel}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="start">
                    {image.documentName}
                  </TooltipContent>
                </Tooltip>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
