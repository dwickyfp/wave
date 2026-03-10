"use client";

import { KnowledgeDocument } from "app-types/knowledge";
import { format } from "date-fns";
import { formatKnowledgeDocumentProcessingState } from "lib/knowledge/processing-state";
import { notify } from "lib/notify";
import { cn } from "lib/utils";
import {
  FileIcon,
  FileTextIcon,
  LinkIcon,
  Loader2Icon,
  RefreshCwIcon,
  TableIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Card } from "ui/card";

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

const STATUS_COLORS: Record<string, string> = {
  pending: "text-yellow-600 border-yellow-500",
  processing: "text-blue-600 border-blue-500",
  ready: "text-green-600 border-green-500",
  failed: "text-red-600 border-red-500",
};

function formatBytes(bytes?: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

interface Props {
  doc: KnowledgeDocument;
  groupId: string;
  onDelete: (docId: string) => void;
  onPreview?: (doc: KnowledgeDocument) => void;
  onReEmbed?: (docId: string) => void;
  onDocumentUpdated?: (doc: KnowledgeDocument) => void;
}

export function DocumentCard({
  doc,
  groupId,
  onDelete,
  onPreview,
  onReEmbed,
  onDocumentUpdated,
}: Props) {
  const [deleting, setDeleting] = useState(false);
  const [reembedding, setReembedding] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const isInherited = !!doc.isInherited;
  const FileIconComp = FILE_ICONS[doc.fileType] ?? FileIcon;
  const processingLabel = formatKnowledgeDocumentProcessingState(
    doc.processingState,
  );
  const isProcessing = doc.status === "processing" || !!doc.processingState;

  const handleReEmbed = async () => {
    setReembedding(true);
    try {
      const res = await fetch(`/api/knowledge/${groupId}/documents/${doc.id}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      onReEmbed?.(doc.id);
      toast.success("Re-embedding started");
    } catch {
      toast.error("Failed to start re-embedding");
    } finally {
      setReembedding(false);
    }
  };

  const handleCancelProcessing = async () => {
    const ok = await notify.confirm({
      title: "Cancel Processing",
      description: `Cancel processing for "${doc.name}"?`,
    });
    if (!ok) return;

    setCanceling(true);
    try {
      const res = await fetch(
        `/api/knowledge/${groupId}/documents/${doc.id}/cancel`,
        {
          method: "POST",
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        doc?: KnowledgeDocument;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "Failed to cancel processing");
      }

      onDocumentUpdated?.(
        data.doc ?? {
          ...doc,
          status: doc.activeVersionId ? "ready" : "failed",
          errorMessage: "Canceled by user",
          processingProgress: null,
          processingState: null,
        },
      );
      toast.success("Document processing canceled");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to cancel processing",
      );
    } finally {
      setCanceling(false);
    }
  };

  const handleDelete = async () => {
    const ok = await notify.confirm({
      title: "Delete Document",
      description: `Delete "${doc.name}"? This will remove all its chunks.`,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/knowledge/${groupId}/documents/${doc.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      onDelete(doc.id);
      toast.success("Document deleted");
    } catch {
      toast.error("Failed to delete document");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card
      className="p-3 flex flex-col gap-2 hover:bg-input transition-colors group cursor-pointer"
      onClick={() => onPreview?.(doc)}
    >
      <div className="flex items-start gap-2.5">
        <div className="shrink-0 p-1.5 rounded-md bg-primary/10">
          <FileIconComp className="size-4 text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" title={doc.name}>
            {doc.name}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {doc.originalFilename}
          </p>
        </div>

        {!isInherited && (
          <div className="flex items-center gap-0.5">
            {isProcessing && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCancelProcessing();
                }}
                disabled={canceling || deleting}
                title="Cancel processing"
              >
                {canceling ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <XIcon className="size-3.5" />
                )}
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                handleReEmbed();
              }}
              disabled={reembedding || canceling || isProcessing}
              title="Reprocess for new structure and embeddings"
            >
              {reembedding ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <RefreshCwIcon className="size-3.5" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete();
              }}
              disabled={deleting || canceling}
              title="Delete document"
            >
              {deleting ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <Trash2Icon className="size-3.5" />
              )}
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className="text-xs px-1.5 py-0">
            {doc.fileType.toUpperCase()}
          </Badge>
          <Badge
            variant="outline"
            className={cn("text-xs px-1.5 py-0", STATUS_COLORS[doc.status])}
          >
            {isProcessing && doc.status === "processing" && (
              <Loader2Icon className="size-2.5 animate-spin mr-1" />
            )}
            {doc.status}
          </Badge>
          {isProcessing && doc.status === "ready" && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              Updating
            </Badge>
          )}
          {isInherited && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              From {doc.sourceGroupName ?? "linked group"}
            </Badge>
          )}
          {doc.tokenCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {doc.tokenCount.toLocaleString()} tokens
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {formatBytes(doc.fileSize)}
          <span>·</span>
          <time>{format(new Date(doc.createdAt), "MMM d")}</time>
        </div>
      </div>

      {isProcessing && (
        <div className="flex w-full flex-col gap-1.5">
          {processingLabel ? (
            <div className="text-[11px] text-muted-foreground">
              {processingLabel}
            </div>
          ) : null}
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${doc.processingProgress ?? 0}%` }}
            />
          </div>
        </div>
      )}
    </Card>
  );
}
