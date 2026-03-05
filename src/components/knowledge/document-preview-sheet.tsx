"use client";

import { KnowledgeDocument } from "app-types/knowledge";
import { cn } from "lib/utils";
import {
  DownloadIcon,
  ExternalLinkIcon,
  FileIcon,
  FileTextIcon,
  LinkIcon,
  Loader2Icon,
  SaveIcon,
  TableIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { ScrollArea } from "ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/tabs";
import { Textarea } from "ui/textarea";

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
    description?: string | null;
    descriptionManual?: boolean;
    titleManual?: boolean;
    originalFilename: string;
    fileType: string;
    fileSize?: number | null;
    mimeType: string;
  };
  previewUrl: string | null;
  sourceUrl: string | null;
  content: string | null;
  markdownContent: string | null;
  isUrlOnly: boolean;
}

interface Props {
  doc: KnowledgeDocument | null;
  groupId: string;
  open: boolean;
  onClose: () => void;
  onDocumentUpdated?: (doc: KnowledgeDocument) => void;
}

export function DocumentPreviewSheet({
  doc,
  groupId,
  open,
  onClose,
  onDocumentUpdated,
}: Props) {
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);

  useEffect(() => {
    if (!open || !doc) {
      setPreviewData(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`/api/knowledge/${groupId}/documents/${doc.id}/preview`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setPreviewData(data);
      })
      .catch((e) => setError(e.message ?? "Failed to load preview"))
      .finally(() => setLoading(false));
  }, [open, doc, groupId]);

  useEffect(() => {
    if (!previewData?.doc) return;
    setTitle(previewData.doc.name ?? "");
    setDescription(previewData.doc.description ?? "");
  }, [
    previewData?.doc?.id,
    previewData?.doc?.name,
    previewData?.doc?.description,
  ]);

  const currentTitle = previewData?.doc?.name ?? "";
  const currentDescription = previewData?.doc?.description ?? "";
  const hasConfigChanges =
    title.trim() !== currentTitle || description.trim() !== currentDescription;

  const handleSaveConfiguration = async () => {
    if (!doc || !previewData?.doc) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error("Title is required");
      return;
    }

    setSavingConfig(true);
    try {
      const trimmedDescription = description.trim();
      const res = await fetch(`/api/knowledge/${groupId}/documents/${doc.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          description: trimmedDescription ? trimmedDescription : null,
        }),
      });
      if (!res.ok) throw new Error("Failed to update document");
      const updated = (await res.json()) as KnowledgeDocument;

      setPreviewData((prev) =>
        prev
          ? {
              ...prev,
              doc: {
                ...prev.doc,
                name: updated.name,
                description: updated.description ?? null,
                titleManual: updated.titleManual ?? true,
                descriptionManual: updated.descriptionManual ?? true,
              },
            }
          : prev,
      );
      onDocumentUpdated?.(updated);
      toast.success("Document metadata updated");
    } catch {
      toast.error("Failed to update document metadata");
    } finally {
      setSavingConfig(false);
    }
  };

  const FileIconComp = FILE_ICONS[doc?.fileType ?? ""] ?? FileIcon;
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col p-0 gap-0"
      >
        <Tabs
          defaultValue="configuration"
          className="flex flex-col flex-1 min-h-0"
        >
          {/* Header */}
          <SheetHeader className="px-6 py-4 border-b shrink-0">
            <div className="flex items-start gap-3">
              <div className="shrink-0 p-2 rounded-md bg-primary/10 mt-0.5">
                <FileIconComp className="size-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <SheetTitle className="text-base font-semibold leading-snug truncate">
                  {doc?.name}
                </SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground truncate mt-0.5">
                  {doc?.originalFilename}
                </SheetDescription>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {doc?.fileType && (
                    <Badge variant="outline" className="text-xs px-1.5 py-0">
                      {doc.fileType.toUpperCase()}
                    </Badge>
                  )}
                  {doc?.fileSize && (
                    <span className="text-xs text-muted-foreground">
                      {formatBytes(doc.fileSize)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <TabsList className="h-8 self-start mt-1">
              <TabsTrigger value="configuration" className="text-xs h-7">
                Configuration
              </TabsTrigger>
              <TabsTrigger value="original" className="text-xs h-7">
                Real Docs
              </TabsTrigger>
              <TabsTrigger
                value="markdown"
                className="text-xs h-7"
                disabled={!previewData?.markdownContent}
              >
                Result Markdown
              </TabsTrigger>
            </TabsList>
          </SheetHeader>

          {/* Content */}
          <div className="flex-1 min-h-0 relative">
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/60 z-10">
                <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {error && (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                <p className="text-sm text-muted-foreground">{error}</p>
              </div>
            )}

            {!loading && !error && previewData && (
              <>
                <TabsContent value="configuration" className="h-full mt-0">
                  <ScrollArea className="h-full">
                    <div className="p-6 flex flex-col gap-4">
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                          Title
                        </Label>
                        <Input
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder="Document title"
                          className="h-9 text-sm"
                        />
                        <p className="text-xs text-muted-foreground">
                          Used for metadata retrieval and document ranking.
                        </p>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                          Description
                        </Label>
                        <Textarea
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          placeholder="Short summary of this document"
                          className="min-h-[140px] resize-y text-sm"
                        />
                        <p className="text-xs text-muted-foreground">
                          Improves semantic and keyword retrieval from title +
                          description.
                        </p>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2">
                        <Button
                          size="sm"
                          className="gap-1.5"
                          onClick={handleSaveConfiguration}
                          disabled={savingConfig || !hasConfigChanges}
                        >
                          <SaveIcon
                            className={cn(
                              "size-3.5",
                              savingConfig && "animate-pulse",
                            )}
                          />
                          Save
                        </Button>
                      </div>
                    </div>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="original" className="h-full mt-0">
                  <PreviewContent data={previewData} />
                </TabsContent>
                <TabsContent value="markdown" className="h-full mt-0">
                  {previewData.markdownContent ? (
                    <ScrollArea className="h-full">
                      <pre className="p-6 text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-foreground/90">
                        {previewData.markdownContent}
                      </pre>
                    </ScrollArea>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                      <p className="text-sm text-muted-foreground">
                        No markdown content yet. The document will be processed
                        after ingestion.
                      </p>
                    </div>
                  )}
                </TabsContent>
              </>
            )}
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function PreviewContent({ data }: { data: PreviewData }) {
  const { doc, previewUrl, sourceUrl, content, isUrlOnly } = data;
  const url = previewUrl ?? sourceUrl;

  // URL-only documents (web pages)
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

  // PDF
  if (doc.fileType === "pdf" && url) {
    return (
      <iframe src={url} className="w-full h-full border-0" title={doc.name} />
    );
  }

  // Images
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

  // Text / Markdown / CSV / HTML
  if (content !== null) {
    return (
      <ScrollArea className="h-full">
        <pre
          className={cn(
            "p-6 text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-foreground/90",
            doc.fileType === "md" &&
              "prose prose-sm dark:prose-invert max-w-none",
          )}
        >
          {content}
        </pre>
      </ScrollArea>
    );
  }

  // Unsupported / binary files
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
