"use client";

import { useEffect, useState } from "react";
import { mutate as swrMutate } from "swr";
import { toast } from "sonner";

const CHAT_MODELS_KEY = "/api/chat/models";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "ui/alert-dialog";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Switch } from "ui/switch";
import { Separator } from "ui/separator";
import {
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Save,
  Image,
  FileText,
  Wrench,
  Sparkles,
  Pencil,
  Check,
  X,
  Tv,
  Brain,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { LlmModelConfig, LlmProviderConfig } from "app-types/settings";
import { cn } from "lib/utils";
import { ModelRegisterDialog } from "./model-register-dialog";
import { getProviderDef } from "./provider-definitions";

interface ProviderConfigSheetProps {
  provider: LlmProviderConfig | null;
  /** Pre-fills the provider ID when creating a known provider that's not yet in DB */
  prefillName?: string;
  /** Pre-fills the display name when creating a known provider that's not yet in DB */
  prefillDisplayName?: string;
  open: boolean;
  onClose: () => void;
}

type CapabilityKey =
  | "supportsTools"
  | "supportsImageInput"
  | "supportsImageGeneration"
  | "supportsFileInput";

const CAPABILITY_ICONS: Record<CapabilityKey, React.ReactNode> = {
  supportsTools: <Wrench className="size-3" />,
  supportsImageInput: <Image className="size-3" />,
  supportsImageGeneration: <Sparkles className="size-3" />,
  supportsFileInput: <FileText className="size-3" />,
};

const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  supportsTools: "Tools",
  supportsImageInput: "Image In",
  supportsImageGeneration: "Img Gen",
  supportsFileInput: "Files",
};

export function ProviderConfigSheet({
  provider,
  prefillName,
  prefillDisplayName,
  open,
  onClose,
}: ProviderConfigSheetProps) {
  const isNew = !provider;
  // Derive def from existing provider, prefill name, or null (fully custom)
  const def = provider
    ? getProviderDef(provider.name)
    : prefillName
      ? getProviderDef(prefillName)
      : null;
  // When a prefill is provided, the provider is known — no need for manual ID/name inputs
  const isPredefined = isNew && !!prefillName;

  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [models, setModels] = useState<LlmModelConfig[]>(
    provider?.models ?? [],
  );
  const [addingModel, setAddingModel] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  // Confirmation dialog state
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    description: string;
    onConfirm: () => void;
  } | null>(null);

  const toggleGroup = (type: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });

  // For new provider form — pre-filled when a known provider def is provided
  const [newProviderName, setNewProviderName] = useState(prefillName ?? "");
  const [newDisplayName, setNewDisplayName] = useState(
    prefillDisplayName ?? "",
  );

  // Sync models when provider changes
  useEffect(() => {
    setModels(provider?.models ?? []);
    setBaseUrl(provider?.baseUrl ?? "");
    setEnabled(provider?.enabled ?? true);
    setApiKey("");
    setShowKey(false);
  }, [provider?.id]);

  const needsApiKey = def ? def.needsApiKey : true;
  const needsBaseUrl = def ? def.needsBaseUrl : false;

  const handleSaveProvider = async () => {
    setSaving(true);
    try {
      if (isNew) {
        if (!newProviderName.trim()) {
          toast.error("Provider name is required");
          return;
        }
        const res = await fetch("/api/settings/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newProviderName.trim(),
            displayName: newDisplayName.trim() || newProviderName.trim(),
            apiKey: apiKey || null,
            baseUrl: baseUrl || null,
            enabled,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create provider");
        toast.success("Provider created");
        onClose();
      } else {
        const res = await fetch(`/api/settings/providers/${provider!.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: provider!.displayName,
            ...(apiKey ? { apiKey } : {}),
            baseUrl: baseUrl || null,
            enabled,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to update provider");
        toast.success("Provider saved");
        onClose();
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to save provider");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProvider = () => {
    if (!provider) return;
    setConfirmAction({
      title: "Delete Provider",
      description: `Delete "${provider.displayName}" and all its models? This cannot be undone.`,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/settings/providers/${provider.id}`, {
            method: "DELETE",
          });
          if (!res.ok) throw new Error("Failed to delete");
          toast.success("Provider deleted");
          onClose();
        } catch (err: any) {
          toast.error(err.message || "Failed to delete provider");
        }
      },
    });
  };

  const handleToggleModel = async (model: LlmModelConfig) => {
    try {
      const res = await fetch(`/api/settings/models/${model.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !model.enabled }),
      });
      if (!res.ok) throw new Error("Failed to update model");
      setModels((prev) =>
        prev.map((m) =>
          m.id === model.id ? { ...m, enabled: !m.enabled } : m,
        ),
      );
      swrMutate(CHAT_MODELS_KEY);
    } catch (err: any) {
      toast.error(err.message || "Failed to update model");
    }
  };

  const handleToggleCapability = async (
    model: LlmModelConfig,
    key: CapabilityKey,
  ) => {
    try {
      const newValue = !model[key];
      const res = await fetch(`/api/settings/models/${model.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: newValue }),
      });
      if (!res.ok) throw new Error("Failed to update model");
      setModels((prev) =>
        prev.map((m) => (m.id === model.id ? { ...m, [key]: newValue } : m)),
      );
      swrMutate(CHAT_MODELS_KEY);
    } catch (err: any) {
      toast.error(err.message || "Failed to update capability");
    }
  };

  const handleUpdateModel = (updated: LlmModelConfig) => {
    setModels((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  };

  const handleDeleteModel = (model: LlmModelConfig) => {
    setConfirmAction({
      title: "Delete Model",
      description: `Delete "${model.uiName}"? This cannot be undone.`,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/settings/models/${model.id}`, {
            method: "DELETE",
          });
          if (!res.ok) throw new Error("Failed to delete model");
          setModels((prev) => prev.filter((m) => m.id !== model.id));
          toast.success("Model deleted");
          swrMutate(CHAT_MODELS_KEY);
        } catch (err: any) {
          toast.error(err.message || "Failed to delete model");
        }
      },
    });
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg flex flex-col p-0 gap-0"
      >
        <SheetHeader className="px-6 py-5 border-b">
          <div className="flex items-center gap-3">
            {def && (
              <div
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg text-xs font-bold shrink-0",
                  def.color,
                  def.textColor,
                )}
              >
                {def.initials}
              </div>
            )}
            <div>
              <SheetTitle className="text-base">
                {isPredefined
                  ? (prefillDisplayName ?? "Configure Provider")
                  : isNew
                    ? "Add Custom Provider"
                    : provider!.displayName}
              </SheetTitle>
              <SheetDescription className="text-xs">
                {isPredefined
                  ? (def?.description ??
                    "Configure API key to enable this provider")
                  : isNew
                    ? "Configure a new AI provider"
                    : (def?.description ?? "Provider settings")}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* New provider fields — only shown for fully custom providers */}
          {isNew && !isPredefined && (
            <>
              <div className="space-y-1.5">
                <Label>Provider ID</Label>
                <Input
                  placeholder="e.g. openai, my-custom-api"
                  value={newProviderName}
                  onChange={(e) => setNewProviderName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase identifier used internally (cannot be changed
                  later).
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Display Name</Label>
                <Input
                  placeholder="e.g. OpenAI, My Custom API"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                />
              </div>
            </>
          )}

          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enable Provider</p>
              <p className="text-xs text-muted-foreground">
                Models from this provider appear in the chat model selector
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <Separator />

          {/* API Key */}
          {needsApiKey && (
            <div className="space-y-1.5">
              <Label>API Key</Label>
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  className="pr-10"
                  placeholder={
                    !isNew && provider?.apiKeyMasked
                      ? "••••••••  (leave blank to keep current)"
                      : (def?.apiKeyPlaceholder ?? "sk-...")
                  }
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
              {!isNew && provider?.apiKeyMasked && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  API key is configured. Enter a new value to replace it.
                </p>
              )}
            </div>
          )}

          {/* Base URL */}
          {(needsBaseUrl || isNew) && (
            <div className="space-y-1.5">
              <Label>
                {def?.baseUrlLabel ?? "Base URL"}{" "}
                {!needsBaseUrl && (
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                )}
              </Label>
              <Input
                placeholder={
                  def?.baseUrlPlaceholder ?? "https://api.example.com/v1"
                }
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>
          )}

          <Separator />

          {/* Models */}
          {!isNew && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  Models{" "}
                  <span className="text-muted-foreground font-normal text-xs">
                    ({models.length})
                  </span>
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 h-7 text-xs"
                  onClick={() => setAddingModel(true)}
                >
                  <Plus className="size-3" />
                  Add
                </Button>
              </div>

              {models.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4 border-2 border-dashed rounded-lg">
                  No models. Click "Add" to register one.
                </p>
              ) : (
                <div className="space-y-4">
                  {MODEL_TYPE_GROUPS.map(({ type, label }) => {
                    const group = models.filter((m) => m.modelType === type);
                    if (group.length === 0) return null;
                    const isCollapsed = collapsedGroups.has(type);
                    return (
                      <div key={type} className="space-y-2">
                        <button
                          type="button"
                          onClick={() => toggleGroup(type)}
                          className="flex items-center gap-1 w-full text-left"
                        >
                          {isCollapsed ? (
                            <ChevronRight className="size-3 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="size-3 text-muted-foreground" />
                          )}
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            {label}
                          </span>
                          <span className="text-xs text-muted-foreground/60 ml-1">
                            ({group.length})
                          </span>
                        </button>
                        {!isCollapsed &&
                          group.map((model) => (
                            <ModelRow
                              key={model.id}
                              model={model}
                              onToggleEnabled={() => handleToggleModel(model)}
                              onToggleCapability={(key) =>
                                handleToggleCapability(model, key)
                              }
                              onDelete={() => handleDeleteModel(model)}
                              onUpdated={handleUpdateModel}
                            />
                          ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t px-6 py-4 flex items-center justify-between gap-3">
          {!isNew && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive gap-1.5"
              onClick={handleDeleteProvider}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveProvider}
              disabled={saving}
              className="gap-1.5"
            >
              <Save className="size-3.5" />
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>

        {/* Add model dialog */}
        {!isNew && addingModel && (
          <ModelRegisterDialog
            open={addingModel}
            providerId={provider!.id}
            providerName={provider!.displayName}
            onClose={() => setAddingModel(false)}
            onCreated={() => {
              // Refresh models from API
              fetch(`/api/settings/models?providerId=${provider!.id}`)
                .then((r) => r.json())
                .then((data) => setModels(data))
                .catch(() => {});
              swrMutate(CHAT_MODELS_KEY);
            }}
          />
        )}
      </SheetContent>

      {/* Confirmation dialog */}
      <AlertDialog
        open={!!confirmAction}
        onOpenChange={(v) => !v && setConfirmAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                confirmAction?.onConfirm();
                setConfirmAction(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

// ─── Model Type Groups ────────────────────────────────────────────────────────

const MODEL_TYPE_GROUPS = [
  { type: "llm" as const, label: "LLM" },
  { type: "image_generation" as const, label: "Image Generation" },
  { type: "embedding" as const, label: "Embedding" },
  { type: "reranking" as const, label: "Reranking" },
];

// ─── Model Row ────────────────────────────────────────────────────────────────

interface ModelRowProps {
  model: LlmModelConfig;
  onToggleEnabled: () => void;
  onToggleCapability: (key: CapabilityKey) => void;
  onDelete: () => void;
  onUpdated: (model: LlmModelConfig) => void;
}

const CAPS: CapabilityKey[] = [
  "supportsTools",
  "supportsImageInput",
  "supportsImageGeneration",
  "supportsFileInput",
];

function ModelRow({
  model,
  onToggleEnabled,
  onToggleCapability,
  onDelete,
  onUpdated,
}: ModelRowProps) {
  const [editing, setEditing] = useState(false);
  const [editUiName, setEditUiName] = useState(model.uiName);
  const [editApiName, setEditApiName] = useState(model.apiName);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/settings/models/${model.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uiName: editUiName.trim(),
          apiName: editApiName.trim(),
        }),
      });
      if (!res.ok) throw new Error("Failed to update model");
      const updated = await res.json();
      onUpdated(updated);
      setEditing(false);
      swrMutate(CHAT_MODELS_KEY);
    } catch (err: any) {
      toast.error(err.message || "Failed to update model");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditUiName(model.uiName);
    setEditApiName(model.apiName);
    setEditing(false);
  };

  return (
    <div
      className={cn(
        "rounded-lg border bg-muted/30 p-3 space-y-2 transition-opacity",
        !model.enabled && "opacity-50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-1.5">
              <div className="relative">
                <Tv className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
                <Input
                  value={editUiName}
                  onChange={(e) => setEditUiName(e.target.value)}
                  placeholder="Display name"
                  className="h-7 text-sm pl-7"
                />
              </div>
              <div className="relative">
                <Brain className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
                <Input
                  value={editApiName}
                  onChange={(e) => setEditApiName(e.target.value)}
                  placeholder="API model name"
                  className="h-7 text-xs pl-7"
                />
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm font-medium truncate">{model.uiName}</p>
              <p className="text-xs text-muted-foreground truncate">
                {model.apiName}
              </p>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {editing ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-foreground"
                onClick={handleSave}
                disabled={saving}
              >
                <Check className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-foreground"
                onClick={handleCancel}
              >
                <X className="size-3" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-foreground"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-3" />
              </Button>
              <Switch
                checked={model.enabled}
                onCheckedChange={onToggleEnabled}
                className="scale-75"
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="size-3" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Capability badges — only relevant for LLM models */}
      {!editing && model.modelType === "llm" && (
        <div className="flex flex-wrap gap-1">
          {CAPS.map((cap) => (
            <button
              key={cap}
              onClick={() => onToggleCapability(cap)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border transition-colors",
                model[cap]
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-muted border-transparent text-muted-foreground",
              )}
              title={`Toggle ${CAPABILITY_LABELS[cap]}`}
            >
              {CAPABILITY_ICONS[cap]}
              {CAPABILITY_LABELS[cap]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
