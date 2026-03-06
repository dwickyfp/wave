"use client";

import { useEffect, useState } from "react";
import useSWR, { mutate as swrMutate } from "swr";
import { toast } from "sonner";
import { fetcher } from "lib/utils";
import { RedisConfig } from "app-types/settings";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Save, Workflow } from "lucide-react";
import { Skeleton } from "ui/skeleton";

const REDIS_KEY = "/api/settings/redis";

const EMPTY: RedisConfig = {
  url: "",
};

export function RedisSettingsTab() {
  const { data, isLoading } = useSWR<RedisConfig | null>(REDIS_KEY, fetcher);
  const [form, setForm] = useState<RedisConfig>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const handleSave = async () => {
    if (!form.url.trim()) {
      toast.error("Redis URL is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(REDIS_KEY, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to save");
      toast.success("Redis settings saved");
      swrMutate(REDIS_KEY);
    } catch (err: any) {
      toast.error(err.message || "Failed to save Redis settings");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-lg space-y-4 mt-6">
        <Skeleton className="h-10 rounded-lg" />
        <Skeleton className="h-10 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-6 mt-6 pt-6 border-t">
      <div className="flex items-center gap-3 p-4 rounded-xl border bg-muted/30">
        <div className="flex size-10 items-center justify-center rounded-lg bg-red-500/10">
          <Workflow className="size-5 text-red-600 dark:text-red-400" />
        </div>
        <div>
          <p className="text-sm font-medium">Redis Connection</p>
          <p className="text-xs text-muted-foreground">
            Redis is used for the knowledge ingestion queue (BullMQ). Falls back
            to the <code className="font-mono">REDIS_URL</code> environment
            variable if not set here. Restart the worker after changing.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="redisUrl">Redis URL</Label>
          <Input
            id="redisUrl"
            placeholder="redis://localhost:6379"
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Format:{" "}
            <code className="font-mono">
              redis://[user:password@]host:port[/db]
            </code>
          </p>
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="gap-2">
        <Save className="size-4" />
        {saving ? "Saving…" : "Save Redis Settings"}
      </Button>
    </div>
  );
}
