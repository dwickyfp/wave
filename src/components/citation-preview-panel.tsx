"use client";

import { useEffect, useRef, useState } from "react";
import { appStore } from "@/app/store";
import type { KnowledgeDocumentPreview } from "app-types/knowledge";
import { useShallow } from "zustand/shallow";
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
import { AnimatePresence, motion } from "framer-motion";
import { KnowledgeDocumentViewer } from "./knowledge/knowledge-document-viewer";

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

function formatPageLabel(
  pageStart?: number | null,
  pageEnd?: number | null,
): string | null {
  if (!pageStart && !pageEnd) return null;
  if (pageStart && pageEnd && pageStart !== pageEnd) {
    return `Pages ${pageStart}-${pageEnd}`;
  }
  return `Page ${pageStart ?? pageEnd}`;
}

type PreviewData = KnowledgeDocumentPreview;

function CitationPanelBody({
  citationPreview,
  previewData,
  loading,
  error,
  onClose,
}: {
  citationPreview: NonNullable<
    ReturnType<typeof appStore.getState>["citationDocumentPreview"]
  >;
  previewData: PreviewData | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const fileType =
    previewData?.doc.fileType ?? citationPreview.fileType ?? "file";
  const FileIconComp = FILE_ICONS[fileType] ?? FileIcon;
  const resolvedPageStart =
    previewData?.resolvedCitationPageStart ?? citationPreview.pageStart ?? null;
  const resolvedPageEnd =
    previewData?.resolvedCitationPageEnd ?? citationPreview.pageEnd ?? null;
  const downloadUrl =
    previewData?.previewUrl ??
    previewData?.assetUrl ??
    previewData?.sourceUrl ??
    null;
  const fallbackWarning =
    previewData?.fallbackWarning ?? citationPreview.fallbackWarning ?? null;

  return (
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
              {citationPreview.citationNumber ? (
                <Badge
                  variant="secondary"
                  className="rounded-full px-2 py-0 text-[11px]"
                >
                  [{citationPreview.citationNumber}]
                </Badge>
              ) : null}
              {fileType ? (
                <Badge
                  variant="outline"
                  className="rounded-full px-2 py-0 text-[11px]"
                >
                  {fileType.toUpperCase()}
                </Badge>
              ) : null}
              {formatPageLabel(resolvedPageStart, resolvedPageEnd) ? (
                <span className="text-xs text-muted-foreground">
                  {formatPageLabel(resolvedPageStart, resolvedPageEnd)}
                </span>
              ) : null}
              {previewData?.doc.fileSize ? (
                <span className="text-xs text-muted-foreground">
                  {formatBytes(previewData.doc.fileSize)}
                </span>
              ) : null}
            </div>
            {fallbackWarning ? (
              <p className="mt-3 text-[11px] leading-relaxed text-amber-700">
                {fallbackWarning}
              </p>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-1 -mt-1 size-8 shrink-0 rounded-full"
            onClick={onClose}
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
              <KnowledgeDocumentViewer
                data={previewData}
                evidence={{
                  pageStart: resolvedPageStart,
                  pageEnd: resolvedPageEnd,
                  sectionHeading: citationPreview.sectionHeading,
                  excerpt: citationPreview.excerpt,
                  fallbackWarning:
                    citationPreview.fallbackWarning ??
                    previewData.fallbackWarning ??
                    null,
                }}
                selectedImageId={citationPreview.imageId ?? null}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
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
    const searchParams = new URLSearchParams();
    if (citationPreview.versionId) {
      searchParams.set("versionId", citationPreview.versionId);
    }
    if (citationPreview.pageStart != null) {
      searchParams.set("pageStart", String(citationPreview.pageStart));
    }
    if (citationPreview.pageEnd != null) {
      searchParams.set("pageEnd", String(citationPreview.pageEnd));
    }
    if (citationPreview.excerpt?.trim()) {
      searchParams.set("excerpt", citationPreview.excerpt.trim().slice(0, 800));
    }
    if (citationPreview.sectionHeading?.trim()) {
      searchParams.set(
        "sectionHeading",
        citationPreview.sectionHeading.trim().slice(0, 200),
      );
    }

    setLoading(true);
    setError(null);
    setPreviewData(null);

    fetch(
      `/api/knowledge/${citationPreview.groupId}/documents/${citationPreview.documentId}/preview${searchParams.toString() ? `?${searchParams.toString()}` : ""}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to load preview");
        }
        return data as PreviewData;
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
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load preview",
        );
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

  return (
    <AnimatePresence>
      {citationPreview ? (
        <>
          <motion.div
            key="citation-panel-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm md:hidden"
            onClick={handleClose}
          />
          <motion.div
            key="citation-panel"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="fixed inset-x-4 bottom-4 top-4 z-50 flex overflow-hidden bg-transparent md:relative md:inset-auto md:z-40 md:h-full md:w-[520px] md:flex-shrink-0 md:p-5"
          >
            <CitationPanelBody
              citationPreview={citationPreview}
              previewData={previewData}
              loading={loading}
              error={error}
              onClose={handleClose}
            />
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
