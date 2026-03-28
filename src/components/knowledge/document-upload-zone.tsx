"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import {
  UploadCloudIcon,
  LinkIcon,
  Loader2Icon,
  AlertCircleIcon,
} from "lucide-react";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { cn } from "lib/utils";
import { toast } from "sonner";

const ACCEPTED_TYPES = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],
  "application/vnd.ms-excel": [".xls"],
  "text/csv": [".csv"],
  "text/plain": [".txt"],
  "text/markdown": [".md"],
};

interface Props {
  groupId: string;
  onUploaded: () => void;
  disabledMessage?: string;
}

export function DocumentUploadZone({
  groupId,
  onUploaded,
  disabledMessage,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [urlMode, setUrlMode] = useState(false);
  const [url, setUrl] = useState("");

  const isDisabled = !!disabledMessage;

  const uploadFile = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    form.append("name", file.name.replace(/\.[^/.]+$/, ""));

    const res = await fetch(`/api/knowledge/${groupId}/documents`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) throw new Error("Upload failed");
    return res.json();
  };

  const onDrop = useCallback(
    async (accepted: File[]) => {
      if (accepted.length === 0) return;
      setUploading(true);

      let successCount = 0;
      let duplicateCount = 0;
      for (const file of accepted) {
        try {
          const result = (await uploadFile(file)) as { duplicate?: boolean };
          if (result.duplicate) {
            duplicateCount++;
            continue;
          }
          successCount++;
        } catch {
          toast.error(`Failed to upload ${file.name}`);
        }
      }

      setUploading(false);
      if (successCount > 0) {
        toast.success(`${successCount} file(s) queued for processing`);
        onUploaded();
      }
      if (duplicateCount > 0) {
        toast.info(`${duplicateCount} file(s) already exist in this knowledge`);
        onUploaded();
      }
    },
    [groupId, onUploaded],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    disabled: uploading || isDisabled,
    multiple: true,
  });

  const handleUrlSubmit = async () => {
    if (!url.trim()) return;
    setUploading(true);
    try {
      const res = await fetch(`/api/knowledge/${groupId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: url }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { duplicate?: boolean };
      if (data.duplicate) {
        toast.info("This URL already exists in this knowledge");
      } else {
        toast.success("URL queued for processing");
      }
      setUrl("");
      setUrlMode(false);
      onUploaded();
    } catch {
      toast.error("Failed to add URL");
    } finally {
      setUploading(false);
    }
  };

  if (isDisabled) {
    return (
      <div className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center gap-2 text-center opacity-60 cursor-not-allowed border-border bg-muted/30">
        <AlertCircleIcon className="size-8 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            Upload disabled
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {disabledMessage}
          </p>
        </div>
      </div>
    );
  }

  if (urlMode) {
    return (
      <div className="flex gap-2">
        <Input
          placeholder="https://example.com/document"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleUrlSubmit()}
          disabled={uploading}
          className="flex-1"
        />
        <Button
          onClick={handleUrlSubmit}
          disabled={uploading || !url.trim()}
          size="sm"
        >
          {uploading ? <Loader2Icon className="size-4 animate-spin" /> : "Add"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setUrlMode(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-lg p-6 flex flex-col items-center gap-2 cursor-pointer transition-colors text-center",
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-accent/30",
          uploading && "opacity-50 cursor-not-allowed",
        )}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <Loader2Icon className="size-8 animate-spin text-muted-foreground" />
        ) : (
          <UploadCloudIcon className="size-8 text-muted-foreground" />
        )}
        <div>
          <p className="text-sm font-medium">
            {isDragActive ? "Drop files here" : "Drag & drop files"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            JPG, PNG, WEBP, GIF, PDF, DOCX, XLSX, CSV, TXT, MD
          </p>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 self-start"
        onClick={() => setUrlMode(true)}
        disabled={uploading}
      >
        <LinkIcon className="size-3.5" />
        Add from URL
      </Button>
    </div>
  );
}
