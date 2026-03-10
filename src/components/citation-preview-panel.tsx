"use client";

import { useEffect, useRef, useState } from "react";
import { appStore } from "@/app/store";
import { useShallow } from "zustand/shallow";
import { ScrollArea } from "ui/scroll-area";
import { Button } from "ui/button";
import { Badge } from "ui/badge";
import {
  FileTextIcon,
  TableIcon,
  FileIcon,
  LinkIcon,
  DownloadIcon,
  Loader2Icon,
  XIcon,
} from "lucide-react";
import { cn } from "lib/utils";
import { AnimatePresence, motion } from "framer-motion";

const FILE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  pdf: FileTextIcon,
  docx: FileTextIcon,
  xlsx: TableIcon,
  csv: TableIcon,
  url: LinkIcon,
  txt: FileTextIcon,
  md: FileTextIcon,
  html: FileTextIcon,
};

function formatBytes(bytes?: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

interface PreviewData {
  doc: {
    id: string;
    name: string;
    originalFilename: string;
    fileType: string;
    fileSize?: number | null;
    mimeType: string;
  };
  previewUrl: string | null;
  sourceUrl: string | null;
  content: string | null;
  isUrlOnly: boolean;
  images?: Array<{
    id: string;
    label: string;
    description: string;
    headingPath?: string | null;
    stepHint?: string | null;
    assetUrl: string | null;
  }>;
}

export function CitationPreviewPanel() {
  const [citationPreview, mutate] = appStore(
    useShallow((state) => [state.citationDocumentPreview, state.mutate]),
  );

  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRequestRef = useRef(0);

  useEffect(() => {
    if (!citationPreview) {
      setLoading(false);
      setPreviewData(null);
      setError(null);
      return;
    }

    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    const controller = new AbortController();

    setLoading(true);
    setError(null);
    setPreviewData(null);

    fetch(
      `/api/knowledge/${citationPreview.groupId}/documents/${citationPreview.documentId}/preview`,
      { signal: controller.signal },
    )
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Failed to load preview");

        if (citationPreview.imageId && citationPreview.versionId) {
          const imageResponse = await fetch(
            `/api/knowledge/${citationPreview.groupId}/documents/${citationPreview.documentId}/images?versionId=${encodeURIComponent(citationPreview.versionId)}`,
            {
              signal: controller.signal,
              cache: "no-store",
            },
          );
          const imageData = await imageResponse.json();
          if (imageResponse.ok && Array.isArray(imageData.images)) {
            data.images = imageData.images;
          }
        }

        return data;
      })
      .then((data) => {
        if (
          controller.signal.aborted ||
          latestRequestRef.current !== requestId
        ) {
          return;
        }
        setPreviewData(data);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setError(e.message ?? "Failed to load preview");
      })
      .finally(() => {
        if (
          controller.signal.aborted ||
          latestRequestRef.current !== requestId
        ) {
          return;
        }
        setLoading(false);
      });

    return () => controller.abort();
  }, [citationPreview]);

  const handleClose = () => {
    mutate({ citationDocumentPreview: null });
  };

  const FileIconComp = FILE_ICONS[citationPreview?.fileType ?? ""] ?? FileIcon;
  const downloadUrl = previewData?.previewUrl ?? previewData?.sourceUrl;

  return (
    <AnimatePresence>
      {citationPreview && (
        <motion.div
          key="citation-panel"
          initial={{ width: 0, opacity: 0, x: 24 }}
          animate={{ width: 520, opacity: 1, x: 0 }}
          exit={{ width: 0, opacity: 0, x: 24 }}
          transition={{ duration: 0.25, ease: "easeInOut" }}
          className="relative z-40 flex h-full flex-shrink-0 overflow-hidden bg-transparent p-5"
        >
          <div className="flex h-full w-full flex-col overflow-hidden rounded-[28px] border border-border/50 bg-background/35 shadow-sm backdrop-blur-xl">
            <div className="border-b border-border/60 px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0 rounded-xl bg-primary/10 p-2">
                  <FileIconComp className="size-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-lg font-semibold leading-snug text-primary"
                    title={citationPreview.documentName}
                  >
                    {citationPreview.documentName}
                  </p>
                  {previewData && (
                    <p
                      className="mt-1 truncate text-xs text-muted-foreground"
                      title={previewData.doc.originalFilename}
                    >
                      {previewData.doc.originalFilename}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {citationPreview.fileType && (
                      <Badge
                        variant="outline"
                        className="rounded-full px-2 py-0 text-[11px]"
                      >
                        {citationPreview.fileType.toUpperCase()}
                      </Badge>
                    )}
                    {previewData?.doc.fileSize && (
                      <span className="text-xs text-muted-foreground">
                        {formatBytes(previewData.doc.fileSize)}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="-mr-1 -mt-1 size-8 shrink-0 rounded-full"
                  onClick={handleClose}
                >
                  <XIcon className="size-4" />
                </Button>
              </div>

              {!loading && downloadUrl && (
                <div className="mt-4 flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className="h-8 gap-1.5 rounded-full text-xs"
                  >
                    <a
                      href={downloadUrl}
                      download={previewData?.doc.originalFilename}
                    >
                      <DownloadIcon className="size-3.5" />
                      Download
                    </a>
                  </Button>
                </div>
              )}
            </div>

            <div className="relative min-h-0 flex-1 bg-background/10">
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
                </div>
              )}

              {error && (
                <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                  <p className="text-sm text-muted-foreground">{error}</p>
                </div>
              )}

              {!loading && !error && previewData && (
                <div className="h-full p-4">
                  <div className="h-full overflow-hidden rounded-3xl border border-border/50 bg-background/30 backdrop-blur-md">
                    <PanelPreviewContent
                      key={`${citationPreview.groupId}:${citationPreview.documentId}`}
                      data={previewData}
                      selectedImageId={citationPreview.imageId ?? null}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PanelPreviewContent({
  data,
  selectedImageId,
}: {
  data: PreviewData;
  selectedImageId?: string | null;
}) {
  const { doc, previewUrl, sourceUrl, content, isUrlOnly, images = [] } = data;
  const url = previewUrl ?? sourceUrl;
  const selectedImage =
    images.find((image) => image.id === selectedImageId) ?? null;

  if (isUrlOnly) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <LinkIcon className="size-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          This is a URL source document.
        </p>
        {sourceUrl && (
          <Button variant="outline" size="sm" asChild>
            <a href={sourceUrl} target="_blank" rel="noreferrer">
              <LinkIcon className="mr-1.5 size-3.5" />
              Open URL
            </a>
          </Button>
        )}
      </div>
    );
  }

  if (selectedImage?.assetUrl) {
    return (
      <ScrollArea className="h-full">
        <div className="flex flex-col gap-4 p-4">
          <div className="overflow-hidden rounded-2xl border border-border/60 bg-muted/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selectedImage.assetUrl}
              alt={selectedImage.label}
              className="max-h-[420px] w-full object-contain"
            />
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium">{selectedImage.label}</div>
            <div className="text-xs leading-relaxed text-muted-foreground">
              {selectedImage.description}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {selectedImage.headingPath || selectedImage.stepHint || doc.name}
            </div>
          </div>
        </div>
      </ScrollArea>
    );
  }

  if (doc.fileType === "pdf" && url) {
    return (
      <iframe src={url} className="h-full w-full border-0" title={doc.name} />
    );
  }

  if (["png", "jpg", "jpeg", "gif", "webp"].includes(doc.fileType) && url) {
    return (
      <div className="flex h-full items-center justify-center overflow-auto p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={doc.name}
          className="max-h-full max-w-full rounded-lg object-contain"
        />
      </div>
    );
  }

  if (content !== null) {
    return (
      <ScrollArea className="h-full">
        <pre
          className={cn(
            "p-4 text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-foreground/90",
          )}
        >
          {content}
        </pre>
      </ScrollArea>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <FileIcon className="size-10 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">
        Preview not available for{" "}
        <span className="font-medium">{doc.fileType.toUpperCase()}</span> files.
      </p>
      {url && (
        <Button variant="outline" size="sm" asChild>
          <a href={url} download={doc.originalFilename}>
            <DownloadIcon className="mr-1.5 size-3.5" />
            Download to view
          </a>
        </Button>
      )}
    </div>
  );
}
