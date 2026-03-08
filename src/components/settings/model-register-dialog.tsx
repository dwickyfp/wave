"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "ui/dialog";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Switch } from "ui/switch";
import { LlmModelConfigInput, ModelType } from "app-types/settings";
import { cn } from "lib/utils";

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
    description: "Large language model for chat & reasoning",
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
    setForm((f) => ({
      ...f,
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
      setForm((f) => ({ ...f, [key]: 0 }));
      return;
    }

    const parsed =
      key === "contextLength" ? parseInt(value, 10) : Number(value);

    if (Number.isNaN(parsed) || parsed < 0) return;

    setForm((f) => ({ ...f, [key]: parsed }));
  };

  const visibleSwitches = CAPABILITY_SWITCHES.filter((s) =>
    s.visibleFor.includes(form.modelType as ModelType),
  );

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
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Model</DialogTitle>
          <DialogDescription>
            Register a new model for <strong>{providerName}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Model Type selector */}
          <div className="space-y-2">
            <Label>Model Type</Label>
            <div className="grid grid-cols-2 gap-2">
              {MODEL_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleTypeChange(opt.value)}
                  className={cn(
                    "flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                    form.modelType === opt.value
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:border-muted-foreground/40 hover:bg-muted/50",
                  )}
                >
                  <span className="font-medium">{opt.label}</span>
                  <span className="text-xs text-muted-foreground leading-snug">
                    {opt.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* API Model Name */}
          <div className="space-y-1.5">
            <Label htmlFor="apiName">API Model Name</Label>
            <Input
              id="apiName"
              placeholder="e.g. gpt-4.1 or openai/gpt-image-1"
              value={form.apiName}
              onChange={(e) =>
                setForm((f) => ({ ...f, apiName: e.target.value }))
              }
            />
            <p className="text-xs text-muted-foreground">
              The exact model ID passed to the provider API.
            </p>
          </div>

          {/* Display Name */}
          <div className="space-y-1.5">
            <Label htmlFor="uiName">Display Name</Label>
            <Input
              id="uiName"
              placeholder="e.g. GPT Image 1"
              value={form.uiName}
              onChange={(e) =>
                setForm((f) => ({ ...f, uiName: e.target.value }))
              }
            />
            <p className="text-xs text-muted-foreground">
              Name shown in the model selector.
            </p>
          </div>

          {form.modelType === "llm" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="contextLength">Context Length</Label>
                <Input
                  id="contextLength"
                  type="number"
                  min="0"
                  step="1"
                  value={form.contextLength}
                  onChange={(e) =>
                    handleNumberChange("contextLength", e.target.value)
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Maximum supported context window for this model. Use 0 if
                  unknown.
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
            </>
          )}

          {/* Capabilities (only for LLM or Image Generation) */}
          {visibleSwitches.length > 0 && (
            <div className="space-y-3 pt-1">
              <p className="text-sm font-medium">Capabilities</p>
              {visibleSwitches.map(({ key, label, description }) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-4"
                >
                  <div>
                    <p className="text-sm">{label}</p>
                    <p className="text-xs text-muted-foreground">
                      {description}
                    </p>
                  </div>
                  <Switch
                    checked={!!form[key]}
                    onCheckedChange={(checked) =>
                      setForm((f) => ({ ...f, [key]: checked }))
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving…" : "Add Model"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
