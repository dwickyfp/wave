"use client";

import { useEffect, useState } from "react";
import useSWR, { mutate as swrMutate } from "swr";
import { toast } from "sonner";
import { fetcher } from "lib/utils";
import { MinioConfig } from "app-types/settings";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Switch } from "ui/switch";
import { Separator } from "ui/separator";
import { Eye, EyeOff, Save, Database } from "lucide-react";
import { Skeleton } from "ui/skeleton";

const MINIO_KEY = "/api/settings/minio";

const EMPTY: MinioConfig = {
  endpoint: "",
  bucket: "",
  accessKey: "",
  secretKey: "",
  region: "",
  useSSL: true,
};

export function MinioSettingsTab() {
  const { data, isLoading } = useSWR<MinioConfig | null>(MINIO_KEY, fetcher);
  const [form, setForm] = useState<MinioConfig>(EMPTY);
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const handleSave = async () => {
    if (!form.endpoint || !form.bucket || !form.accessKey) {
      toast.error("Endpoint, bucket, and access key are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(MINIO_KEY, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to save");
      toast.success("Minio settings saved");
      swrMutate(MINIO_KEY);
    } catch (err: any) {
      toast.error(err.message || "Failed to save Minio settings");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-lg space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3 p-4 rounded-xl border bg-muted/30">
        <div className="flex size-10 items-center justify-center rounded-lg bg-cyan-500/10">
          <Database className="size-5 text-cyan-600 dark:text-cyan-400" />
        </div>
        <div>
          <p className="text-sm font-medium">MinIO Object Storage</p>
          <p className="text-xs text-muted-foreground">
            Configure your MinIO (or S3-compatible) storage for file uploads.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="endpoint">Endpoint URL</Label>
          <Input
            id="endpoint"
            placeholder="https://minio.example.com or http://localhost:9000"
            value={form.endpoint}
            onChange={(e) =>
              setForm((f) => ({ ...f, endpoint: e.target.value }))
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bucket">Bucket Name</Label>
          <Input
            id="bucket"
            placeholder="my-bucket"
            value={form.bucket}
            onChange={(e) => setForm((f) => ({ ...f, bucket: e.target.value }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="accessKey">Access Key</Label>
            <Input
              id="accessKey"
              placeholder="minioadmin"
              value={form.accessKey}
              onChange={(e) =>
                setForm((f) => ({ ...f, accessKey: e.target.value }))
              }
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="secretKey">Secret Key</Label>
            <div className="relative">
              <Input
                id="secretKey"
                type={showSecret ? "text" : "password"}
                className="pr-10"
                placeholder={data?.secretKey ? "••••••••" : "minioadmin"}
                value={form.secretKey}
                onChange={(e) =>
                  setForm((f) => ({ ...f, secretKey: e.target.value }))
                }
                autoComplete="off"
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowSecret((v) => !v)}
              >
                {showSecret ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="region">
            Region{" "}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
          </Label>
          <Input
            id="region"
            placeholder="us-east-1"
            value={form.region ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
          />
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Use SSL / HTTPS</p>
            <p className="text-xs text-muted-foreground">
              Disable for local development (HTTP)
            </p>
          </div>
          <Switch
            checked={form.useSSL}
            onCheckedChange={(checked) =>
              setForm((f) => ({ ...f, useSSL: checked }))
            }
          />
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="gap-2">
        <Save className="size-4" />
        {saving ? "Saving…" : "Save Settings"}
      </Button>
    </div>
  );
}
