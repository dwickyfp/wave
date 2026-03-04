"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { UploadCloudIcon, LinkIcon, Loader2Icon } from "lucide-react";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { cn } from "lib/utils";
import { toast } from "sonner";

const ACCEPTED_TYPES = {
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
}

export function DocumentUploadZone({ groupId, onUploaded }: Props) {
  const [uploading, setUploading] = useState(false);
  const [urlMode, setUrlMode] = useState(false);
  const [url, setUrl] = useState("");

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
      for (const file of accepted) {
        try {
          await uploadFile(file);
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
    },
    [groupId, onUploaded],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    disabled: uploading,
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
      toast.success("URL queued for processing");
      setUrl("");
      setUrlMode(false);
      onUploaded();
    } catch {
      toast.error("Failed to add URL");
    } finally {
      setUploading(false);
    }
  };

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
            PDF, DOCX, XLSX, CSV, TXT, MD — or click to browse
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
