"use client";

import { useState, useEffect } from "react";
import useSWR, { mutate as swrMutate } from "swr";
import { fetcher } from "lib/utils";
import { Button } from "ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";
import { BookOpen, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { LlmProviderConfig } from "app-types/settings";
import {
  ModelSelector,
  NONE_VALUE,
  parseModelValue,
  makeModelValue,
} from "@/components/knowledge/knowledge-model-selector";

const CONTEXTX_MODEL_KEY = "/api/settings/contextx-model";
const PROVIDERS_KEY = "/api/settings/providers";

type ContextXModelConfig = {
  provider: string;
  model: string;
} | null;

export function ContextXModelButton() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: config } = useSWR<ContextXModelConfig>(
    CONTEXTX_MODEL_KEY,
    fetcher,
  );
  const { data: providers } = useSWR<LlmProviderConfig[]>(
    PROVIDERS_KEY,
    fetcher,
  );

  const [selectedValue, setSelectedValue] = useState(NONE_VALUE);

  // Sync with fetched config
  useEffect(() => {
    if (config) {
      setSelectedValue(makeModelValue(config.provider, config.model));
    } else {
      setSelectedValue(NONE_VALUE);
    }
  }, [config]);

  // Adapt LlmProviderConfig[] → ModelSelectorProvider[]
  const chatProviders = (providers ?? [])
    .filter(
      (p) =>
        p.enabled && p.models.some((m) => m.modelType === "llm" && m.enabled),
    )
    .map((p) => ({
      provider: p.name,
      displayName: p.displayName,
      hasAPIKey: !!p.apiKeyMasked,
      models: p.models
        .filter((m) => m.modelType === "llm" && m.enabled)
        .map((m) => ({ uiName: m.uiName, apiName: m.apiName })),
    }));

  async function handleSave() {
    const parsed = parseModelValue(selectedValue);
    if (!parsed) {
      toast.error("Please select a model");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(CONTEXTX_MODEL_KEY, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: parsed.provider,
          model: parsed.apiName,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      toast.success("ContextX model configured");
      swrMutate(CONTEXTX_MODEL_KEY);
      setOpen(false);
    } catch {
      toast.error("Failed to save ContextX model");
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    try {
      const res = await fetch(CONTEXTX_MODEL_KEY, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "null",
      });
      if (!res.ok) throw new Error("Failed to clear");
      setSelectedValue(NONE_VALUE);
      toast.success("ContextX model cleared");
      swrMutate(CONTEXTX_MODEL_KEY);
      setOpen(false);
    } catch {
      toast.error("Failed to clear ContextX model");
    } finally {
      setSaving(false);
    }
  }

  const parsed = parseModelValue(selectedValue);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <BookOpen className="size-4" />
          ContextX Model
          {config && (
            <span className="text-muted-foreground text-xs ml-1 max-w-[120px] truncate">
              ({config.model})
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-4">
          <div>
            <h4 className="font-medium text-sm">ContextX LLM Model</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Choose the LLM used for contextual enrichment during document
              ingestion. This model generates context summaries for each chunk,
              improving retrieval accuracy.
            </p>
          </div>

          <ModelSelector
            value={selectedValue}
            onValueChange={setSelectedValue}
            providers={chatProviders}
            placeholder="Select model"
            allowNone
            noneLabel="Not configured"
          />

          {config && (
            <p className="text-xs text-muted-foreground">
              Current:{" "}
              <span className="font-mono">
                {config.provider}/{config.model}
              </span>
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="flex-1 gap-1.5"
              onClick={handleSave}
              disabled={saving || !parsed || selectedValue === NONE_VALUE}
            >
              {saving ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Check className="size-3" />
              )}
              Save
            </Button>
            {config && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleClear}
                disabled={saving}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
