"use client";

import { useEffect, useState } from "react";
import useSWR, { mutate as swrMutate } from "swr";
import { toast } from "sonner";
import { fetcher } from "lib/utils";
import type { FileStorageConfig, FileStorageType } from "app-types/settings";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Skeleton } from "ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "ui/select";
import { Save, HardDrive } from "lucide-react";

const STORAGE_KEY = "/api/settings/storage";
const MASKED = "********";

const EMPTY: FileStorageConfig = {
  type: "none",
  s3: {
    bucket: "",
    region: "",
    endpoint: "",
    accessKey: "",
    secretKey: "",
    publicBaseUrl: "",
    forcePathStyle: false,
  },
  vercelBlob: {
    token: "",
  },
};

export function StorageSettingsTab() {
  const { data, isLoading } = useSWR<FileStorageConfig | null>(
    STORAGE_KEY,
    fetcher,
  );
  const [form, setForm] = useState<FileStorageConfig>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setForm({
        ...EMPTY,
        ...data,
        s3: { ...EMPTY.s3, ...(data.s3 ?? {}) },
        vercelBlob: { ...EMPTY.vercelBlob, ...(data.vercelBlob ?? {}) },
      });
    }
  }, [data]);

  const setS3 = (field: string, value: string | boolean) =>
    setForm((f) => ({ ...f, s3: { ...f.s3, [field]: value } }));

  const setVercelBlob = (field: string, value: string) =>
    setForm((f) => ({ ...f, vercelBlob: { ...f.vercelBlob, [field]: value } }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(STORAGE_KEY, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to save");
      toast.success("Storage settings saved");
      swrMutate(STORAGE_KEY);
    } catch (err: any) {
      toast.error(err.message || "Failed to save storage settings");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-lg space-y-4 mt-6">
        <Skeleton className="h-10 rounded-lg" />
        <Skeleton className="h-10 rounded-lg" />
        <Skeleton className="h-10 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-6 mt-6">
      <div className="flex items-center gap-3 p-4 rounded-xl border bg-muted/30">
        <div className="flex size-10 items-center justify-center rounded-lg bg-blue-500/10">
          <HardDrive className="size-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <p className="text-sm font-medium">File Storage</p>
          <p className="text-xs text-muted-foreground">
            Configure where uploaded files and knowledge documents are stored.
            Settings here override environment variables.
          </p>
        </div>
      </div>

      {/* Storage type selector */}
      <div className="space-y-1.5">
        <Label>Storage Type</Label>
        <Select
          value={form.type}
          onValueChange={(val) =>
            setForm((f) => ({ ...f, type: val as FileStorageType }))
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Select storage type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None (disabled)</SelectItem>
            <SelectItem value="s3">S3 / MinIO</SelectItem>
            <SelectItem value="vercel-blob">Vercel Blob</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Falls back to the <code className="font-mono">FILE_STORAGE_TYPE</code>{" "}
          environment variable if not set.
        </p>
      </div>

      {/* S3 / MinIO fields */}
      {form.type === "s3" && (
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="s3Bucket">Bucket</Label>
            <Input
              id="s3Bucket"
              placeholder="my-bucket"
              value={form.s3?.bucket ?? ""}
              onChange={(e) => setS3("bucket", e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="s3Region">Region</Label>
            <Input
              id="s3Region"
              placeholder="us-east-1"
              value={form.s3?.region ?? ""}
              onChange={(e) => setS3("region", e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="s3Endpoint">
              Endpoint{" "}
              <span className="text-muted-foreground font-normal">
                (optional — for MinIO or other S3-compatible stores)
              </span>
            </Label>
            <Input
              id="s3Endpoint"
              placeholder="https://minio.example.com"
              value={form.s3?.endpoint ?? ""}
              onChange={(e) => setS3("endpoint", e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="s3AccessKey">Access Key ID</Label>
            <Input
              id="s3AccessKey"
              placeholder="AKIAIOSFODNN7EXAMPLE"
              value={form.s3?.accessKey ?? ""}
              onChange={(e) => setS3("accessKey", e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="s3SecretKey">Secret Access Key</Label>
            <Input
              id="s3SecretKey"
              type="password"
              placeholder={data?.s3?.secretKey ? MASKED : "Enter secret key"}
              value={form.s3?.secretKey ?? ""}
              onChange={(e) => setS3("secretKey", e.target.value)}
              autoComplete="new-password"
            />
            {data?.s3?.secretKey && (
              <p className="text-xs text-muted-foreground">
                A key is already saved. Leave blank to keep the existing one.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="s3PublicBaseUrl">
              Public Base URL{" "}
              <span className="text-muted-foreground font-normal">
                (optional — CDN or public bucket URL)
              </span>
            </Label>
            <Input
              id="s3PublicBaseUrl"
              placeholder="https://cdn.example.com"
              value={form.s3?.publicBaseUrl ?? ""}
              onChange={(e) => setS3("publicBaseUrl", e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="forcePathStyle"
              type="checkbox"
              checked={form.s3?.forcePathStyle ?? false}
              onChange={(e) => setS3("forcePathStyle", e.target.checked)}
              className="rounded border"
            />
            <Label htmlFor="forcePathStyle" className="cursor-pointer">
              Force path-style URLs{" "}
              <span className="text-muted-foreground font-normal">
                (required for MinIO / self-hosted stores)
              </span>
            </Label>
          </div>
        </div>
      )}

      {/* Vercel Blob fields */}
      {form.type === "vercel-blob" && (
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="vercelToken">BLOB_READ_WRITE_TOKEN</Label>
            <Input
              id="vercelToken"
              type="password"
              placeholder={
                data?.vercelBlob?.token ? MASKED : "vercel_blob_rw_…"
              }
              value={form.vercelBlob?.token ?? ""}
              onChange={(e) => setVercelBlob("token", e.target.value)}
              autoComplete="new-password"
            />
            {data?.vercelBlob?.token && (
              <p className="text-xs text-muted-foreground">
                A token is already saved. Leave blank to keep the existing one.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Leave blank to use the{" "}
              <code className="font-mono">BLOB_READ_WRITE_TOKEN</code>{" "}
              environment variable.
            </p>
          </div>
        </div>
      )}

      <Button onClick={handleSave} disabled={saving} className="gap-2">
        <Save className="size-4" />
        {saving ? "Saving…" : "Save Storage Settings"}
      </Button>
    </div>
  );
}
