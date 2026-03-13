"use client";

import type { KnowledgeDocumentPreview } from "app-types/knowledge";
import { cn } from "lib/utils";
import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileIcon,
  LinkIcon,
  Loader2Icon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { ScrollArea } from "ui/scroll-area";

type CitationEvidence = {
  pageStart?: number | null;
  pageEnd?: number | null;
  sectionHeading?: string | null;
  excerpt?: string | null;
  fallbackWarning?: string | null;
};

function isImageFileType(fileType: string) {
  return ["png", "jpg", "jpeg", "gif", "webp"].includes(fileType);
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

function PdfDocumentViewer({
  assetUrl,
  initialPage,
}: {
  assetUrl: string;
  initialPage?: number | null;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [pdfDocument, setPdfDocument] = useState<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(initialPage ?? 1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [loadingDocument, setLoadingDocument] = useState(true);
  const [renderingPage, setRenderingPage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCurrentPage(initialPage ?? 1);
  }, [initialPage, assetUrl]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const updateWidth = () => {
      setContainerWidth(element.clientWidth);
    };
    updateWidth();

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: any = null;
    let loadedDocument: any = null;

    const load = async () => {
      setLoadingDocument(true);
      setError(null);
      setPdfDocument(null);
      setPageCount(0);

      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.mjs",
          import.meta.url,
        ).toString();

        loadingTask = pdfjs.getDocument({
          url: assetUrl,
          disableAutoFetch: true,
          disableRange: true,
          disableStream: true,
          isEvalSupported: false,
        });

        const nextDocument = await loadingTask.promise;
        loadedDocument = nextDocument;
        if (cancelled) {
          await nextDocument.destroy();
          return;
        }

        setPdfDocument(nextDocument);
        setPageCount(nextDocument.numPages);
        setCurrentPage((current) =>
          Math.min(
            Math.max(current || initialPage || 1, 1),
            nextDocument.numPages,
          ),
        );
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load PDF",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingDocument(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      void loadingTask?.destroy?.();
      void loadedDocument?.destroy?.();
      setPdfDocument(null);
    };
  }, [assetUrl]);

  useEffect(() => {
    if (!pdfDocument || !canvasRef.current || !textLayerRef.current) {
      return;
    }

    let cancelled = false;
    let renderTask: any = null;

    const render = async () => {
      setRenderingPage(true);
      setError(null);

      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const page = await pdfDocument.getPage(currentPage);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale =
          containerWidth > 0
            ? Math.max(0.6, Math.min(2.6, containerWidth / baseViewport.width))
            : 1;
        const viewport = page.getViewport({ scale });
        const devicePixelRatio = window.devicePixelRatio || 1;
        const canvas = canvasRef.current;
        const textLayer = textLayerRef.current;
        if (!canvas || !textLayer || cancelled) return;

        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas context unavailable");

        canvas.width = Math.ceil(viewport.width * devicePixelRatio);
        canvas.height = Math.ceil(viewport.height * devicePixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        textLayer.innerHTML = "";
        textLayer.style.width = `${viewport.width}px`;
        textLayer.style.height = `${viewport.height}px`;

        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform:
            devicePixelRatio === 1
              ? undefined
              : [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0],
        });
        await renderTask.promise;

        const textContent = await page.getTextContent();
        const nextTextLayer = new pdfjs.TextLayer({
          textContentSource: textContent,
          container: textLayer,
          viewport,
        });
        await nextTextLayer.render();
      } catch (renderError) {
        if (!cancelled) {
          setError(
            renderError instanceof Error
              ? renderError.message
              : "Failed to render PDF page",
          );
        }
      } finally {
        if (!cancelled) {
          setRenderingPage(false);
        }
      }
    };

    void render();

    return () => {
      cancelled = true;
      void renderTask?.cancel?.();
    };
  }, [containerWidth, currentPage, pdfDocument]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="rounded-full text-[11px]">
            PDF
          </Badge>
          <span className="text-xs text-muted-foreground">
            {pageCount > 0 ? `Page ${currentPage} / ${pageCount}` : "Loading"}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-full"
            disabled={loadingDocument || renderingPage || currentPage <= 1}
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-full"
            disabled={
              loadingDocument ||
              renderingPage ||
              pageCount === 0 ||
              currentPage >= pageCount
            }
            onClick={() =>
              setCurrentPage((page) => Math.min(pageCount, page + 1))
            }
          >
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="relative min-h-0 flex-1 overflow-auto bg-muted/20 p-4"
      >
        {(loadingDocument || renderingPage) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 backdrop-blur-[1px]">
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
            <Button type="button" variant="outline" size="sm" asChild>
              <a href={assetUrl} target="_blank" rel="noreferrer">
                <ExternalLinkIcon className="mr-1.5 size-3.5" />
                Open PDF
              </a>
            </Button>
          </div>
        ) : (
          <div className="mx-auto w-fit rounded-2xl border border-border/60 bg-background shadow-sm">
            <div className="relative">
              <canvas
                ref={canvasRef}
                className="block max-w-full rounded-2xl"
              />
              <div
                ref={textLayerRef}
                className="pdf-text-layer absolute inset-0 overflow-hidden rounded-2xl"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function KnowledgeDocumentViewer({
  data,
  evidence,
  selectedImageId,
}: {
  data: KnowledgeDocumentPreview;
  evidence?: CitationEvidence;
  selectedImageId?: string | null;
}) {
  const {
    doc,
    assetUrl,
    previewUrl,
    sourceUrl,
    content,
    isUrlOnly,
    images = [],
  } = data;
  const url = assetUrl ?? previewUrl ?? sourceUrl;
  const selectedImage =
    images.find((image) => image.id === selectedImageId) ?? null;
  const effectiveWarning =
    evidence?.fallbackWarning ?? data.fallbackWarning ?? null;
  const effectivePageLabel = formatPageLabel(
    evidence?.pageStart,
    evidence?.pageEnd,
  );

  if (isUrlOnly) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <LinkIcon className="size-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          This source is a URL-only document.
        </p>
        {sourceUrl && (
          <Button variant="outline" size="sm" asChild>
            <a href={sourceUrl} target="_blank" rel="noreferrer">
              <ExternalLinkIcon className="mr-1.5 size-3.5" />
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
          {effectiveWarning ? (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700">
              {effectiveWarning}
            </div>
          ) : null}

          <div className="overflow-hidden rounded-2xl border border-border/60 bg-muted/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selectedImage.assetUrl}
              alt={selectedImage.label}
              className="max-h-[420px] w-full object-contain"
            />
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-medium">{selectedImage.label}</div>
              {effectivePageLabel ? (
                <Badge variant="outline" className="rounded-full text-[11px]">
                  {effectivePageLabel}
                </Badge>
              ) : null}
            </div>
            <div className="text-xs leading-relaxed text-muted-foreground">
              {selectedImage.description}
            </div>
          </div>
        </div>
      </ScrollArea>
    );
  }

  if (doc.fileType === "pdf" && url) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {effectiveWarning ? (
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700">
            <span className="inline-flex items-center gap-1 font-medium">
              <AlertTriangleIcon className="size-3.5" />
              {effectiveWarning}
            </span>
          </div>
        ) : null}
        <PdfDocumentViewer
          assetUrl={url}
          initialPage={evidence?.pageStart ?? 1}
        />
      </div>
    );
  }

  if (isImageFileType(doc.fileType) && url) {
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
        <div className="flex flex-col gap-3 p-4">
          {effectiveWarning ? (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700">
              {effectiveWarning}
            </div>
          ) : null}
          {effectivePageLabel ||
          evidence?.sectionHeading ||
          evidence?.excerpt ? (
            <div className="rounded-2xl border border-border/60 bg-muted/15 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {effectivePageLabel ? (
                  <Badge variant="outline" className="rounded-full text-[11px]">
                    {effectivePageLabel}
                  </Badge>
                ) : null}
                {evidence?.sectionHeading ? (
                  <span className="text-xs font-medium text-foreground/85">
                    {evidence.sectionHeading}
                  </span>
                ) : null}
              </div>
              {evidence?.excerpt ? (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {evidence.excerpt}
                </p>
              ) : null}
            </div>
          ) : null}
          <pre
            className={cn(
              "rounded-2xl border border-border/50 bg-background/50 p-4 text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-foreground/90",
            )}
          >
            {content}
          </pre>
        </div>
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
