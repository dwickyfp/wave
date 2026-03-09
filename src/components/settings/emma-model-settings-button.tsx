"use client";

import { useEffect, useState, type ComponentType } from "react";
import useSWR, { mutate as swrMutate } from "swr";
import type { LlmProviderConfig } from "app-types/settings";
import type {
  EvaluationJudgeModelConfig,
  SelfLearningEmbeddingModelConfig,
} from "app-types/self-learning";
import { fetcher } from "lib/utils";
import {
  BookOpen,
  BrainCircuit,
  Check,
  Database,
  Loader2,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";
import {
  makeModelValue,
  ModelSelector,
  type ModelSelectorProvider,
  NONE_VALUE,
  parseModelValue,
} from "@/components/knowledge/knowledge-model-selector";

const PROVIDERS_KEY = "/api/settings/providers";
const CONTEXTX_MODEL_KEY = "/api/settings/contextx-model";
const JUDGE_MODEL_KEY = "/api/settings/evaluation-judge-model";
const EMBEDDING_MODEL_KEY = "/api/settings/self-learning-embedding-model";

type ContextXModelConfig = {
  provider: string;
  model: string;
} | null;

type SettingCardProps = {
  title: string;
  description: string;
  value: string;
  onValueChange: (value: string) => void;
  providers: ModelSelectorProvider[];
  placeholder: string;
  icon: ComponentType<{ className?: string }>;
  noneLabel?: string;
};

function getConfiguredValue(
  config:
    | ContextXModelConfig
    | EvaluationJudgeModelConfig
    | SelfLearningEmbeddingModelConfig
    | null
    | undefined,
) {
  if (!config) return NONE_VALUE;
  return makeModelValue(config.provider, config.model);
}

function buildProviders(
  providers: LlmProviderConfig[] | undefined,
  modelType: "llm" | "embedding",
) {
  return (providers ?? [])
    .filter(
      (provider) =>
        provider.enabled &&
        provider.models.some(
          (model) => model.modelType === modelType && model.enabled,
        ),
    )
    .map((provider) => ({
      provider: provider.name,
      displayName: provider.displayName,
      hasAPIKey: !!provider.apiKeyMasked,
      models: provider.models
        .filter((model) => model.modelType === modelType && model.enabled)
        .map((model) => ({
          uiName: model.uiName,
          apiName: model.apiName,
        })),
    }));
}

function SettingCard({
  title,
  description,
  value,
  onValueChange,
  providers,
  placeholder,
  icon: Icon,
  noneLabel = "Not configured",
}: SettingCardProps) {
  const parsed = parseModelValue(value);

  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md border border-border/70 bg-background p-2">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm">{title}</div>
          <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
            {description}
          </p>
        </div>
      </div>

      <ModelSelector
        value={value}
        onValueChange={onValueChange}
        providers={providers}
        placeholder={placeholder}
        allowNone
        noneLabel={noneLabel}
      />

      <p className="text-muted-foreground text-xs">
        Current:{" "}
        <span className="font-mono">
          {parsed ? `${parsed.provider}/${parsed.apiName}` : noneLabel}
        </span>
      </p>
    </div>
  );
}

export function EmmaModelSettingsButton() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: providers } = useSWR<LlmProviderConfig[]>(
    PROVIDERS_KEY,
    fetcher,
  );
  const { data: contextxConfig } = useSWR<ContextXModelConfig>(
    CONTEXTX_MODEL_KEY,
    fetcher,
  );
  const { data: judgeConfig } = useSWR<EvaluationJudgeModelConfig | null>(
    JUDGE_MODEL_KEY,
    fetcher,
  );
  const { data: embeddingConfig } =
    useSWR<SelfLearningEmbeddingModelConfig | null>(
      EMBEDDING_MODEL_KEY,
      fetcher,
    );

  const [contextxValue, setContextxValue] = useState(NONE_VALUE);
  const [judgeValue, setJudgeValue] = useState(NONE_VALUE);
  const [embeddingValue, setEmbeddingValue] = useState(NONE_VALUE);

  useEffect(() => {
    setContextxValue(getConfiguredValue(contextxConfig));
  }, [contextxConfig]);

  useEffect(() => {
    setJudgeValue(getConfiguredValue(judgeConfig));
  }, [judgeConfig]);

  useEffect(() => {
    setEmbeddingValue(getConfiguredValue(embeddingConfig));
  }, [embeddingConfig]);

  const llmProviders = buildProviders(providers, "llm");
  const embeddingProviders = buildProviders(providers, "embedding");

  const currentContextxValue = getConfiguredValue(contextxConfig);
  const currentJudgeValue = getConfiguredValue(judgeConfig);
  const currentEmbeddingValue = getConfiguredValue(embeddingConfig);

  const configuredCount = [contextxConfig, judgeConfig, embeddingConfig].filter(
    Boolean,
  ).length;
  const isLoading =
    contextxConfig === undefined ||
    judgeConfig === undefined ||
    embeddingConfig === undefined;
  const isDirty =
    contextxValue !== currentContextxValue ||
    judgeValue !== currentJudgeValue ||
    embeddingValue !== currentEmbeddingValue;

  async function saveSetting(url: string, value: string) {
    const parsed = parseModelValue(value);
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: parsed
        ? JSON.stringify({
            provider: parsed.provider,
            model: parsed.apiName,
          })
        : "null",
    });

    if (!response.ok) {
      const data = await response
        .json()
        .catch(() => ({ error: "Failed to save setting" }));
      throw new Error(data.error || "Failed to save setting");
    }
  }

  async function handleSaveAll() {
    setSaving(true);

    const tasks = [
      {
        label: "ContextX model",
        url: CONTEXTX_MODEL_KEY,
        value: contextxValue,
      },
      {
        label: "Evaluation judge",
        url: JUDGE_MODEL_KEY,
        value: judgeValue,
      },
      {
        label: "Self-learning embedding",
        url: EMBEDDING_MODEL_KEY,
        value: embeddingValue,
      },
    ];

    const results = await Promise.allSettled(
      tasks.map((task) => saveSetting(task.url, task.value)),
    );

    await Promise.all([
      swrMutate(CONTEXTX_MODEL_KEY),
      swrMutate(JUDGE_MODEL_KEY),
      swrMutate(EMBEDDING_MODEL_KEY),
    ]);

    const failedLabels = tasks
      .map((task, index) => ({
        label: task.label,
        result: results[index],
      }))
      .filter(
        (
          entry,
        ): entry is {
          label: string;
          result: PromiseRejectedResult;
        } => entry.result.status === "rejected",
      )
      .map((entry) => entry.label);

    if (failedLabels.length > 0) {
      toast.error(`Failed to save: ${failedLabels.join(", ")}`);
      setSaving(false);
      return;
    }

    toast.success("Emma model settings updated");
    setSaving(false);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="min-w-[260px] justify-between gap-3"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="size-4" />
            Emma Models
          </span>
          <span className="text-muted-foreground text-xs">
            {configuredCount}/3 configured
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-4" align="end">
        <div className="space-y-4">
          <div>
            <h4 className="font-medium text-sm">Emma Model Setup</h4>
            <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
              Configure ContextX, the evaluation judge, and self-learning
              embeddings in one place.
            </p>
          </div>

          <div className="space-y-3">
            <SettingCard
              title="ContextX Model"
              description="Used for contextual enrichment during knowledge ingestion."
              value={contextxValue}
              onValueChange={setContextxValue}
              providers={llmProviders}
              placeholder="Select ContextX model"
              icon={BookOpen}
            />
            <SettingCard
              title="Evaluation Judge"
              description="Used to score conversations and propose reusable personalization memories."
              value={judgeValue}
              onValueChange={setJudgeValue}
              providers={llmProviders}
              placeholder="Select judge model"
              icon={BrainCircuit}
            />
            <SettingCard
              title="Self-Learning Embed"
              description="Used to rebuild the hidden personalization knowledge store for learned memories."
              value={embeddingValue}
              onValueChange={setEmbeddingValue}
              providers={embeddingProviders}
              placeholder="Select embedding model"
              icon={Database}
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-border/60 border-t pt-2">
            <p className="text-muted-foreground text-xs">
              Set any selector to{" "}
              <span className="font-medium">Not configured</span> to clear it.
            </p>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={handleSaveAll}
              disabled={saving || isLoading || !isDirty}
            >
              {saving ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Check className="size-3" />
              )}
              Save all
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
