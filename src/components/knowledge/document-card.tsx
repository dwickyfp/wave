"use client";

import { KnowledgeDocument } from "app-types/knowledge";
import { format } from "date-fns";
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
}

export function DocumentCard({
  doc,
  groupId,
  onDelete,
  onPreview,
  onReEmbed,
}: Props) {
  const [deleting, setDeleting] = useState(false);
  const [reembedding, setReembedding] = useState(false);
  const isInherited = !!doc.isInherited;
  const FileIconComp = FILE_ICONS[doc.fileType] ?? FileIcon;

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
          {doc.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {doc.description}
            </p>
          )}
        </div>

        {!isInherited && (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                handleReEmbed();
              }}
              disabled={reembedding || doc.status === "processing"}
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
              disabled={deleting}
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
            {doc.status === "processing" && (
              <Loader2Icon className="size-2.5 animate-spin mr-1" />
            )}
            {doc.status}
          </Badge>
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
    </Card>
  );
}
