"use client";

import { useState, useEffect } from "react";
import useSWR, { mutate as swrMutate } from "swr";
import { fetcher } from "lib/utils";
import { Button } from "ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "ui/select";
import { BookOpen, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { LlmProviderConfig } from "app-types/settings";

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

  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");

  // Sync with fetched config
  useEffect(() => {
    if (config) {
      setSelectedProvider(config.provider);
      setSelectedModel(config.model);
    }
  }, [config]);

  // Get models for the selected provider (only LLM type)
  const providerModels =
    providers
      ?.find((p) => p.name === selectedProvider)
      ?.models.filter((m) => m.modelType === "llm" && m.enabled) ?? [];

  // Enabled providers with at least one LLM model
  const enabledProviders =
    providers?.filter(
      (p) =>
        p.enabled && p.models.some((m) => m.modelType === "llm" && m.enabled),
    ) ?? [];

  async function handleSave() {
    if (!selectedProvider || !selectedModel) {
      toast.error("Please select a provider and model");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(CONTEXTX_MODEL_KEY, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedProvider,
          model: selectedModel,
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
      setSelectedProvider("");
      setSelectedModel("");
      toast.success("ContextX model cleared");
      swrMutate(CONTEXTX_MODEL_KEY);
      setOpen(false);
    } catch {
      toast.error("Failed to clear ContextX model");
    } finally {
      setSaving(false);
    }
  }

  const currentLabel = config
    ? `${config.provider}/${config.model}`
    : "Not configured";

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

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Provider</label>
              <Select
                value={selectedProvider}
                onValueChange={(v) => {
                  setSelectedProvider(v);
                  setSelectedModel(""); // Reset model when provider changes
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Enabled Providers</SelectLabel>
                    {enabledProviders.map((p) => (
                      <SelectItem key={p.name} value={p.name}>
                        {p.displayName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Model</label>
              <Select
                value={selectedModel}
                onValueChange={setSelectedModel}
                disabled={!selectedProvider}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue
                    placeholder={
                      selectedProvider
                        ? "Select model"
                        : "Choose provider first"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>LLM Models</SelectLabel>
                    {providerModels.map((m) => (
                      <SelectItem key={m.uiName} value={m.uiName}>
                        {m.uiName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          {config && (
            <p className="text-xs text-muted-foreground">
              Current: <span className="font-mono">{currentLabel}</span>
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="flex-1 gap-1.5"
              onClick={handleSave}
              disabled={saving || !selectedProvider || !selectedModel}
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
