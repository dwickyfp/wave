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
  ImageIcon,
  Loader2,
  Mic2,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";
import { Switch } from "ui/switch";
import {
  makeModelValue,
  ModelSelector,
  type ModelSelectorProvider,
  NONE_VALUE,
  parseModelValue,
} from "@/components/knowledge/knowledge-model-selector";

const PROVIDERS_KEY = "/api/settings/providers";
const PARSE_MODEL_KEY = "/api/settings/knowledge-parse-model";
const CONTEXT_MODEL_KEY = "/api/settings/knowledge-context-model";
const IMAGE_MODEL_KEY = "/api/settings/knowledge-image-model";
const IMAGE_NEIGHBOR_CONTEXT_KEY =
  "/api/settings/knowledge-image-neighbor-context-enabled";
const JUDGE_MODEL_KEY = "/api/settings/evaluation-judge-model";
const EMBEDDING_MODEL_KEY = "/api/settings/self-learning-embedding-model";
const VOICE_CHAT_MODEL_KEY = "/api/settings/voice-chat-model";

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
  const { data: parseConfig } = useSWR<ContextXModelConfig>(
    PARSE_MODEL_KEY,
    fetcher,
  );
  const { data: contextConfig } = useSWR<ContextXModelConfig>(
    CONTEXT_MODEL_KEY,
    fetcher,
  );
  const { data: imageConfig } = useSWR<ContextXModelConfig>(
    IMAGE_MODEL_KEY,
    fetcher,
  );
  const { data: imageNeighborContextEnabledConfig } = useSWR<boolean>(
    IMAGE_NEIGHBOR_CONTEXT_KEY,
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
  const { data: voiceChatConfig } = useSWR<ContextXModelConfig>(
    VOICE_CHAT_MODEL_KEY,
    fetcher,
  );

  const [parseValue, setParseValue] = useState(NONE_VALUE);
  const [contextValue, setContextValue] = useState(NONE_VALUE);
  const [imageValue, setImageValue] = useState(NONE_VALUE);
  const [imageNeighborContextEnabled, setImageNeighborContextEnabled] =
    useState(true);
  const [judgeValue, setJudgeValue] = useState(NONE_VALUE);
  const [embeddingValue, setEmbeddingValue] = useState(NONE_VALUE);
  const [voiceChatValue, setVoiceChatValue] = useState(NONE_VALUE);

  useEffect(() => {
    setParseValue(getConfiguredValue(parseConfig));
  }, [parseConfig]);

  useEffect(() => {
    setContextValue(getConfiguredValue(contextConfig));
  }, [contextConfig]);

  useEffect(() => {
    setImageValue(getConfiguredValue(imageConfig));
  }, [imageConfig]);

  useEffect(() => {
    setImageNeighborContextEnabled(imageNeighborContextEnabledConfig ?? true);
  }, [imageNeighborContextEnabledConfig]);

  useEffect(() => {
    setJudgeValue(getConfiguredValue(judgeConfig));
  }, [judgeConfig]);

  useEffect(() => {
    setEmbeddingValue(getConfiguredValue(embeddingConfig));
  }, [embeddingConfig]);

  useEffect(() => {
    setVoiceChatValue(getConfiguredValue(voiceChatConfig));
  }, [voiceChatConfig]);

  const llmProviders = buildProviders(providers, "llm");
  const embeddingProviders = buildProviders(providers, "embedding");

  const currentParseValue = getConfiguredValue(parseConfig);
  const currentContextValue = getConfiguredValue(contextConfig);
  const currentImageValue = getConfiguredValue(imageConfig);
  const currentImageNeighborContextEnabled =
    imageNeighborContextEnabledConfig ?? true;
  const currentJudgeValue = getConfiguredValue(judgeConfig);
  const currentEmbeddingValue = getConfiguredValue(embeddingConfig);
  const currentVoiceChatValue = getConfiguredValue(voiceChatConfig);

  const configuredCount = [
    parseConfig,
    contextConfig,
    imageConfig,
    judgeConfig,
    embeddingConfig,
    voiceChatConfig,
  ].filter(Boolean).length;
  const isLoading =
    parseConfig === undefined ||
    contextConfig === undefined ||
    imageConfig === undefined ||
    imageNeighborContextEnabledConfig === undefined ||
    judgeConfig === undefined ||
    embeddingConfig === undefined ||
    voiceChatConfig === undefined;
  const isDirty =
    parseValue !== currentParseValue ||
    contextValue !== currentContextValue ||
    imageValue !== currentImageValue ||
    imageNeighborContextEnabled !== currentImageNeighborContextEnabled ||
    judgeValue !== currentJudgeValue ||
    embeddingValue !== currentEmbeddingValue ||
    voiceChatValue !== currentVoiceChatValue;

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

  async function saveBooleanSetting(url: string, value: boolean) {
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
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
        label: "Knowledge parse",
        url: PARSE_MODEL_KEY,
        value: parseValue,
        kind: "model" as const,
      },
      {
        label: "Knowledge context",
        url: CONTEXT_MODEL_KEY,
        value: contextValue,
        kind: "model" as const,
      },
      {
        label: "Knowledge image",
        url: IMAGE_MODEL_KEY,
        value: imageValue,
        kind: "model" as const,
      },
      {
        label: "Image neighbor context",
        url: IMAGE_NEIGHBOR_CONTEXT_KEY,
        value: imageNeighborContextEnabled,
        kind: "boolean" as const,
      },
      {
        label: "Evaluation judge",
        url: JUDGE_MODEL_KEY,
        value: judgeValue,
        kind: "model" as const,
      },
      {
        label: "Self-learning embedding",
        url: EMBEDDING_MODEL_KEY,
        value: embeddingValue,
        kind: "model" as const,
      },
      {
        label: "Voice chat",
        url: VOICE_CHAT_MODEL_KEY,
        value: voiceChatValue,
        kind: "model" as const,
      },
    ];

    const results = await Promise.allSettled(
      tasks.map((task) =>
        task.kind === "boolean"
          ? saveBooleanSetting(task.url, task.value as boolean)
          : saveSetting(task.url, task.value as string),
      ),
    );

    await Promise.all([
      swrMutate(PARSE_MODEL_KEY),
      swrMutate(CONTEXT_MODEL_KEY),
      swrMutate(IMAGE_MODEL_KEY),
      swrMutate(IMAGE_NEIGHBOR_CONTEXT_KEY),
      swrMutate(JUDGE_MODEL_KEY),
      swrMutate(EMBEDDING_MODEL_KEY),
      swrMutate(VOICE_CHAT_MODEL_KEY),
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
            {configuredCount}/6 configured
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-4" align="end">
        <div className="space-y-4">
          <div>
            <h4 className="font-medium text-sm">Emma Model Setup</h4>
            <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
              Configure knowledge parsing, chunk context, image analysis,
              evaluation, and self-learning embeddings in one place.
            </p>
          </div>

          <div
            className="max-h-[60vh] space-y-3 overflow-y-auto pr-1"
            onWheel={(e) => e.stopPropagation()}
          >
            <SettingCard
              title="Knowledge Parse"
              description="Used for readability-focused page repair when extraction quality is low."
              value={parseValue}
              onValueChange={setParseValue}
              providers={llmProviders}
              placeholder="Select parse model"
              icon={BookOpen}
            />
            <SettingCard
              title="Knowledge Context"
              description="Used only when chunk context mode allows LLM summaries for weakly structured chunks."
              value={contextValue}
              onValueChange={setContextValue}
              providers={llmProviders}
              placeholder="Select context model"
              icon={BrainCircuit}
            />
            <SettingCard
              title="Knowledge Image"
              description="Used for vision-based image analysis and image labeling during knowledge ingest."
              value={imageValue}
              onValueChange={setImageValue}
              providers={llmProviders}
              placeholder="Select image model"
              icon={ImageIcon}
            />
            <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm">
                    Image Neighbor Context
                  </div>
                  <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
                    Adds one short disambiguating sentence from the text
                    immediately before or after the image when it improves
                    retrieval relevance.
                  </p>
                </div>
                <Switch
                  checked={imageNeighborContextEnabled}
                  onCheckedChange={setImageNeighborContextEnabled}
                />
              </div>
              <p className="text-muted-foreground text-xs">
                Current:{" "}
                <span className="font-mono">
                  {imageNeighborContextEnabled ? "enabled" : "disabled"}
                </span>
              </p>
            </div>
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
            <SettingCard
              title="Voice Chat"
              description="Default model used for real-time voice chat sessions. Should be a Realtime-capable model (e.g. gpt-4o-realtime-preview)."
              value={voiceChatValue}
              onValueChange={setVoiceChatValue}
              providers={llmProviders}
              placeholder="Select voice chat model"
              icon={Mic2}
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
