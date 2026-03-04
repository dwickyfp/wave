"use client";

import { useState, useEffect } from "react";
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
  ExternalLinkIcon,
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
}

export function CitationPreviewPanel() {
  const [citationPreview, mutate] = appStore(
    useShallow((state) => [state.citationDocumentPreview, state.mutate]),
  );

  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!citationPreview) {
      setPreviewData(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    setPreviewData(null);

    fetch(
      `/api/knowledge/${citationPreview.groupId}/documents/${citationPreview.documentId}/preview`,
    )
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setPreviewData(data);
      })
      .catch((e) => setError(e.message ?? "Failed to load preview"))
      .finally(() => setLoading(false));
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
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 420, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeInOut" }}
          className="relative flex-shrink-0 h-full overflow-hidden border-l bg-background flex flex-col"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b shrink-0 flex flex-col gap-2">
            <div className="flex items-start gap-3">
              <div className="shrink-0 p-1.5 rounded-md bg-primary/10 mt-0.5">
                <FileIconComp className="size-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-semibold leading-snug truncate"
                  title={citationPreview.documentName}
                >
                  {citationPreview.documentName}
                </p>
                {previewData && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {previewData.doc.originalFilename}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {citationPreview.fileType && (
                    <Badge variant="outline" className="text-xs px-1.5 py-0">
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
                className="size-7 shrink-0 -mt-1 -mr-1"
                onClick={handleClose}
              >
                <XIcon className="size-4" />
              </Button>
            </div>

            {!loading && downloadUrl && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="h-7 text-xs gap-1.5"
                >
                  <a href={downloadUrl} target="_blank" rel="noreferrer">
                    <ExternalLinkIcon className="size-3.5" />
                    Open
                  </a>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="h-7 text-xs gap-1.5"
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

          {/* Content */}
          <div className="flex-1 min-h-0 relative">
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {error && (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                <p className="text-sm text-muted-foreground">{error}</p>
              </div>
            )}

            {!loading && !error && previewData && (
              <PanelPreviewContent data={previewData} />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PanelPreviewContent({ data }: { data: PreviewData }) {
  const { doc, previewUrl, sourceUrl, content, isUrlOnly } = data;
  const url = previewUrl ?? sourceUrl;

  if (isUrlOnly) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-4 text-center">
        <LinkIcon className="size-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          This is a URL source document.
        </p>
        {sourceUrl && (
          <Button variant="outline" size="sm" asChild>
            <a href={sourceUrl} target="_blank" rel="noreferrer">
              <ExternalLinkIcon className="size-3.5 mr-1.5" />
              Open URL
            </a>
          </Button>
        )}
      </div>
    );
  }

  if (doc.fileType === "pdf" && url) {
    return (
      <iframe src={url} className="w-full h-full border-0" title={doc.name} />
    );
  }

  if (["png", "jpg", "jpeg", "gif", "webp"].includes(doc.fileType) && url) {
    return (
      <div className="flex items-center justify-center h-full p-4 overflow-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={doc.name}
          className="max-w-full max-h-full object-contain rounded-lg"
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
    <div className="flex flex-col items-center justify-center h-full p-8 gap-4 text-center">
      <FileIcon className="size-10 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">
        Preview not available for{" "}
        <span className="font-medium">{doc.fileType.toUpperCase()}</span> files.
      </p>
      {url && (
        <Button variant="outline" size="sm" asChild>
          <a href={url} download={doc.originalFilename}>
            <DownloadIcon className="size-3.5 mr-1.5" />
            Download to view
          </a>
        </Button>
      )}
    </div>
  );
}
