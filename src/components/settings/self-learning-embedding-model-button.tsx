"use client";

import { useEffect, useState } from "react";
import useSWR, { mutate as swrMutate } from "swr";
import type { LlmProviderConfig } from "app-types/settings";
import type { SelfLearningEmbeddingModelConfig } from "app-types/self-learning";
import { fetcher } from "lib/utils";
import { Check, Database, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";
import {
  makeModelValue,
  ModelSelector,
  NONE_VALUE,
  parseModelValue,
} from "@/components/knowledge/knowledge-model-selector";

const EMBEDDING_MODEL_KEY = "/api/settings/self-learning-embedding-model";
const PROVIDERS_KEY = "/api/settings/providers";

export function SelfLearningEmbeddingModelButton() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedValue, setSelectedValue] = useState(NONE_VALUE);

  const { data: config } = useSWR<SelfLearningEmbeddingModelConfig | null>(
    EMBEDDING_MODEL_KEY,
    fetcher,
  );
  const { data: providers } = useSWR<LlmProviderConfig[]>(
    PROVIDERS_KEY,
    fetcher,
  );

  useEffect(() => {
    if (config) {
      setSelectedValue(makeModelValue(config.provider, config.model));
      return;
    }

    setSelectedValue(NONE_VALUE);
  }, [config]);

  const embeddingProviders = (providers ?? [])
    .filter(
      (provider) =>
        provider.enabled &&
        provider.models.some(
          (model) => model.modelType === "embedding" && model.enabled,
        ),
    )
    .map((provider) => ({
      provider: provider.name,
      displayName: provider.displayName,
      hasAPIKey: !!provider.apiKeyMasked,
      models: provider.models
        .filter((model) => model.modelType === "embedding" && model.enabled)
        .map((model) => ({
          uiName: model.uiName,
          apiName: model.apiName,
        })),
    }));

  async function saveConfig() {
    const parsed = parseModelValue(selectedValue);
    if (!parsed) {
      toast.error("Please select an embedding model");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(EMBEDDING_MODEL_KEY, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: parsed.provider,
          model: parsed.apiName,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save");
      }

      await swrMutate(EMBEDDING_MODEL_KEY);
      toast.success("Self-learning embedding model configured");
      setOpen(false);
    } catch {
      toast.error("Failed to save self-learning embedding model");
    } finally {
      setSaving(false);
    }
  }

  async function clearConfig() {
    setSaving(true);
    try {
      const response = await fetch(EMBEDDING_MODEL_KEY, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "null",
      });

      if (!response.ok) {
        throw new Error("Failed to clear");
      }

      setSelectedValue(NONE_VALUE);
      await swrMutate(EMBEDDING_MODEL_KEY);
      toast.success("Self-learning embedding model cleared");
      setOpen(false);
    } catch {
      toast.error("Failed to clear self-learning embedding model");
    } finally {
      setSaving(false);
    }
  }

  const parsed = parseModelValue(selectedValue);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="justify-start gap-2">
          <Database className="size-4" />
          Self-Learning Embed
          {config && (
            <span className="ml-1 max-w-[140px] truncate text-muted-foreground text-xs">
              ({config.model})
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-4">
          <div>
            <h4 className="font-medium text-sm">
              Self-Learning Embedding Model
            </h4>
            <p className="mt-1 text-muted-foreground text-xs">
              Choose the embedding model used when Emma rebuilds hidden
              personalization knowledge for self-learning memories.
            </p>
          </div>

          <ModelSelector
            value={selectedValue}
            onValueChange={setSelectedValue}
            providers={embeddingProviders}
            placeholder="Select embedding model"
            allowNone
            noneLabel="Not configured"
          />

          {config && (
            <p className="text-muted-foreground text-xs">
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
              onClick={saveConfig}
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
                onClick={clearConfig}
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
