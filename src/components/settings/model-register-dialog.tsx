"use client";

import { LlmModelConfigInput, ModelType } from "app-types/settings";
import { cn } from "lib/utils";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Switch } from "ui/switch";

interface ModelRegisterDialogProps {
  open: boolean;
  providerId: string;
  providerName: string;
  onClose: () => void;
  onCreated: () => void;
}

interface ModelTypeOption {
  value: ModelType;
  label: string;
  description: string;
}

const MODEL_TYPE_OPTIONS: ModelTypeOption[] = [
  {
    value: "llm",
    label: "LLM",
    description: "Large language model for chat and reasoning",
  },
  {
    value: "image_generation",
    label: "Image Generation",
    description: "Generates or edits images from prompts",
  },
  {
    value: "embedding",
    label: "Embedding",
    description: "Converts text to vector embeddings",
  },
  {
    value: "reranking",
    label: "Reranking",
    description: "Reranks search results for relevance",
  },
];

interface CapabilitySwitch {
  key: keyof Pick<
    LlmModelConfigInput,
    | "supportsTools"
    | "supportsGeneration"
    | "supportsImageInput"
    | "supportsImageGeneration"
    | "supportsFileInput"
  >;
  label: string;
  description: string;
  visibleFor: ModelType[];
}

const CAPABILITY_SWITCHES: CapabilitySwitch[] = [
  {
    key: "supportsTools",
    label: "Tool / Function Calling",
    description: "Can call external tools and MCP servers",
    visibleFor: ["llm"],
  },
  {
    key: "supportsGeneration",
    label: "Generate Capabilities",
    description: "Can be used for generating agents, subagents, and skills",
    visibleFor: ["llm"],
  },
  {
    key: "supportsImageInput",
    label: "Image Input",
    description: "Accepts image attachments from the user",
    visibleFor: ["llm", "image_generation"],
  },
  {
    key: "supportsImageGeneration",
    label: "Image Generation Output",
    description: "Can generate images as chat output",
    visibleFor: ["llm"],
  },
  {
    key: "supportsFileInput",
    label: "File Input",
    description: "Accepts file attachments (PDF, etc.)",
    visibleFor: ["llm"],
  },
];

const DEFAULT_CAPABILITIES: Record<
  ModelType,
  Pick<
    LlmModelConfigInput,
    | "contextLength"
    | "inputTokenPricePer1MUsd"
    | "outputTokenPricePer1MUsd"
    | "supportsTools"
    | "supportsGeneration"
    | "supportsImageInput"
    | "supportsImageGeneration"
    | "supportsFileInput"
  >
> = {
  llm: {
    contextLength: 0,
    inputTokenPricePer1MUsd: 0,
    outputTokenPricePer1MUsd: 0,
    supportsTools: true,
    supportsGeneration: false,
    supportsImageInput: false,
    supportsImageGeneration: false,
    supportsFileInput: false,
  },
  image_generation: {
    contextLength: 0,
    inputTokenPricePer1MUsd: 0,
    outputTokenPricePer1MUsd: 0,
    supportsTools: false,
    supportsGeneration: false,
    supportsImageInput: true,
    supportsImageGeneration: false,
    supportsFileInput: false,
  },
  embedding: {
    contextLength: 0,
    inputTokenPricePer1MUsd: 0,
    outputTokenPricePer1MUsd: 0,
    supportsTools: false,
    supportsGeneration: false,
    supportsImageInput: false,
    supportsImageGeneration: false,
    supportsFileInput: false,
  },
  reranking: {
    contextLength: 0,
    inputTokenPricePer1MUsd: 0,
    outputTokenPricePer1MUsd: 0,
    supportsTools: false,
    supportsGeneration: false,
    supportsImageInput: false,
    supportsImageGeneration: false,
    supportsFileInput: false,
  },
};

export function ModelRegisterDialog({
  open,
  providerId,
  providerName,
  onClose,
  onCreated,
}: ModelRegisterDialogProps) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<LlmModelConfigInput>({
    apiName: "",
    uiName: "",
    enabled: true,
    ...DEFAULT_CAPABILITIES.llm,
    modelType: "llm",
    sortOrder: 0,
  });

  const handleTypeChange = (type: ModelType) => {
    setForm((current) => ({
      ...current,
      modelType: type,
      ...DEFAULT_CAPABILITIES[type],
    }));
  };

  const handleNumberChange = (
    key:
      | "contextLength"
      | "inputTokenPricePer1MUsd"
      | "outputTokenPricePer1MUsd",
    raw: string,
  ) => {
    const value = raw.trim();
    if (!value.length) {
      setForm((current) => ({ ...current, [key]: 0 }));
      return;
    }

    const parsed =
      key === "contextLength" ? parseInt(value, 10) : Number(value);

    if (Number.isNaN(parsed) || parsed < 0) return;

    setForm((current) => ({ ...current, [key]: parsed }));
  };

  const visibleSwitches = CAPABILITY_SWITCHES.filter((switchItem) =>
    switchItem.visibleFor.includes(form.modelType as ModelType),
  );
  const selectedType =
    MODEL_TYPE_OPTIONS.find((option) => option.value === form.modelType) ??
    MODEL_TYPE_OPTIONS[0];

  const handleSubmit = async () => {
    if (!form.apiName.trim() || !form.uiName.trim()) {
      toast.error("API name and display name are required");
      return;
    }

    if (
      form.contextLength < 0 ||
      form.inputTokenPricePer1MUsd < 0 ||
      form.outputTokenPricePer1MUsd < 0
    ) {
      toast.error("Numeric model settings cannot be negative");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/settings/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, providerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create model");

      toast.success(`Model "${form.uiName}" added`);
      onCreated();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to create model");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-3xl gap-0 overflow-hidden p-0 sm:max-h-[calc(100vh-4rem)] sm:max-w-3xl">
        <div className="flex max-h-[calc(100vh-1.5rem)] flex-col sm:max-h-[calc(100vh-4rem)]">
          <DialogHeader className="border-b px-4 py-4 pr-12 sm:px-6 sm:py-5">
            <DialogTitle>Add Model</DialogTitle>
            <DialogDescription className="space-y-1">
              <span className="block">
                Register a new model for <strong>{providerName}</strong>.
              </span>
              <span className="block text-xs">
                The form stays scrollable on smaller screens so the actions
                remain reachable.
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            <div className="space-y-6 p-4 sm:p-6">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.85fr)]">
                <div className="space-y-6">
                  <section className="rounded-xl border bg-muted/20 p-4 sm:p-5">
                    <div className="mb-4 space-y-1">
                      <h3 className="text-sm font-medium">Model Type</h3>
                      <p className="text-xs text-muted-foreground">
                        Pick the capability profile that best matches the
                        provider model you are registering.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {MODEL_TYPE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => handleTypeChange(option.value)}
                          className={cn(
                            "flex min-h-24 flex-col items-start justify-between rounded-xl border px-4 py-3 text-left transition-colors",
                            form.modelType === option.value
                              ? "border-primary bg-primary/10 text-foreground shadow-sm"
                              : "border-border bg-background hover:border-muted-foreground/40 hover:bg-muted/50",
                          )}
                        >
                          <span className="text-sm font-medium">
                            {option.label}
                          </span>
                          <span className="text-xs leading-relaxed text-muted-foreground">
                            {option.description}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-xl border p-4 sm:p-5">
                    <div className="mb-4 space-y-1">
                      <h3 className="text-sm font-medium">Identity</h3>
                      <p className="text-xs text-muted-foreground">
                        Use the provider-facing model ID and a shorter display
                        name for internal selection lists.
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="apiName">API Model Name</Label>
                        <Input
                          id="apiName"
                          placeholder="e.g. gpt-4.1 or openai/gpt-image-1"
                          value={form.apiName}
                          onChange={(e) =>
                            setForm((current) => ({
                              ...current,
                              apiName: e.target.value,
                            }))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          The exact model ID passed to the provider API.
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="uiName">Display Name</Label>
                        <Input
                          id="uiName"
                          placeholder="e.g. GPT Image 1"
                          value={form.uiName}
                          onChange={(e) =>
                            setForm((current) => ({
                              ...current,
                              uiName: e.target.value,
                            }))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Name shown in the model selector.
                        </p>
                      </div>
                    </div>
                  </section>

                  {form.modelType === "llm" && (
                    <section className="rounded-xl border p-4 sm:p-5">
                      <div className="mb-4 space-y-1">
                        <h3 className="text-sm font-medium">
                          Runtime and Pricing
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Add capacity and cost metadata so users can compare
                          models more easily.
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <Label htmlFor="contextLength">Context Length</Label>
                          <Input
                            id="contextLength"
                            type="number"
                            min="0"
                            step="1"
                            value={form.contextLength}
                            onChange={(e) =>
                              handleNumberChange(
                                "contextLength",
                                e.target.value,
                              )
                            }
                          />
                          <p className="text-xs text-muted-foreground">
                            Maximum supported context window for this model. Use
                            0 if unknown.
                          </p>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor="inputTokenPricePer1MUsd">
                              Input Price / 1M Tokens (USD)
                            </Label>
                            <Input
                              id="inputTokenPricePer1MUsd"
                              type="number"
                              min="0"
                              step="0.000001"
                              value={form.inputTokenPricePer1MUsd}
                              onChange={(e) =>
                                handleNumberChange(
                                  "inputTokenPricePer1MUsd",
                                  e.target.value,
                                )
                              }
                            />
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor="outputTokenPricePer1MUsd">
                              Output Price / 1M Tokens (USD)
                            </Label>
                            <Input
                              id="outputTokenPricePer1MUsd"
                              type="number"
                              min="0"
                              step="0.000001"
                              value={form.outputTokenPricePer1MUsd}
                              onChange={(e) =>
                                handleNumberChange(
                                  "outputTokenPricePer1MUsd",
                                  e.target.value,
                                )
                              }
                            />
                          </div>
                        </div>
                      </div>
                    </section>
                  )}
                </div>

                <div className="space-y-6">
                  <section className="rounded-xl border bg-muted/20 p-4 sm:p-5">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      Summary
                    </p>
                    <div className="mt-4 space-y-4">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Provider
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {providerName}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-muted-foreground">
                          Selected Type
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {selectedType.label}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {selectedType.description}
                        </p>
                      </div>

                      <div className="rounded-lg border bg-background px-3 py-2.5">
                        <p className="text-xs text-muted-foreground">
                          Required before saving
                        </p>
                        <p className="mt-1 text-sm">
                          API model name and display name
                        </p>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-xl border p-4 sm:p-5">
                    <div className="mb-4 space-y-1">
                      <h3 className="text-sm font-medium">Capabilities</h3>
                      <p className="text-xs text-muted-foreground">
                        Toggle only the behaviors this model should expose to
                        the app.
                      </p>
                    </div>

                    {visibleSwitches.length > 0 ? (
                      <div className="space-y-3">
                        {visibleSwitches.map(({ key, label, description }) => (
                          <div
                            key={key}
                            className="flex items-start justify-between gap-4 rounded-xl border bg-muted/20 px-3 py-3"
                          >
                            <div className="space-y-1 pr-2">
                              <p className="text-sm font-medium">{label}</p>
                              <p className="text-xs leading-relaxed text-muted-foreground">
                                {description}
                              </p>
                            </div>
                            <Switch
                              checked={!!form[key]}
                              onCheckedChange={(checked) =>
                                setForm((current) => ({
                                  ...current,
                                  [key]: checked,
                                }))
                              }
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
                        This model type does not expose extra capability flags.
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="border-t bg-background px-4 py-4 sm:px-6">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? "Saving..." : "Add Model"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
