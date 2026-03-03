"use client";

import { useEffect, useState } from "react";
import useSWR, { mutate as swrMutate } from "swr";
import { toast } from "sonner";
import { fetcher } from "lib/utils";
import { OtherConfig } from "app-types/settings";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Eye, EyeOff, Save, Settings2 } from "lucide-react";
import { Skeleton } from "ui/skeleton";

const OTHER_CONFIGS_KEY = "/api/settings/other-configs";

const EMPTY: OtherConfig = {
  exaApiKey: "",
};

export function OtherConfigsTab() {
  const { data, isLoading } = useSWR<OtherConfig | null>(
    OTHER_CONFIGS_KEY,
    fetcher,
  );
  const [form, setForm] = useState<OtherConfig>(EMPTY);
  const [showExaKey, setShowExaKey] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(OTHER_CONFIGS_KEY, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to save");
      toast.success("Settings saved");
      swrMutate(OTHER_CONFIGS_KEY);
    } catch (err: any) {
      toast.error(err.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-lg space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3 p-4 rounded-xl border bg-muted/30">
        <div className="flex size-10 items-center justify-center rounded-lg bg-indigo-500/10">
          <Settings2 className="size-5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <p className="text-sm font-medium">Other Configurations</p>
          <p className="text-xs text-muted-foreground">
            API keys and settings for additional integrations.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="exaApiKey">Exa API Key</Label>
          <p className="text-xs text-muted-foreground">
            Used for web search via the Exa API. Get a key at{" "}
            <a
              href="https://exa.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              exa.ai
            </a>
            .
          </p>
          <div className="relative">
            <Input
              id="exaApiKey"
              type={showExaKey ? "text" : "password"}
              className="pr-10"
              placeholder={
                data?.exaApiKey ? "••••••••" : "Enter your Exa API key"
              }
              value={form.exaApiKey ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, exaApiKey: e.target.value }))
              }
              autoComplete="off"
            />
            <button
              type="button"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowExaKey((v) => !v)}
            >
              {showExaKey ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="gap-2">
        <Save className="size-4" />
        {saving ? "Saving…" : "Save Settings"}
      </Button>
    </div>
  );
}
