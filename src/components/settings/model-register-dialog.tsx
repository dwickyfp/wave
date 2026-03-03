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
import { LlmModelConfigInput } from "app-types/settings";

interface ModelRegisterDialogProps {
  open: boolean;
  providerId: string;
  providerName: string;
  onClose: () => void;
  onCreated: () => void;
}

const CAPABILITY_SWITCHES: Array<{
  key: keyof Pick<
    LlmModelConfigInput,
    | "supportsTools"
    | "supportsImageInput"
    | "supportsImageGeneration"
    | "supportsFileInput"
  >;
  label: string;
  description: string;
}> = [
  {
    key: "supportsTools",
    label: "Tool / Function Calling",
    description: "Can call external tools and MCP servers",
  },
  {
    key: "supportsImageInput",
    label: "Image Input",
    description: "Accepts image attachments from the user",
  },
  {
    key: "supportsImageGeneration",
    label: "Image Generation",
    description: "Can generate images as output",
  },
  {
    key: "supportsFileInput",
    label: "File Input",
    description: "Accepts file attachments (PDF, etc.)",
  },
];

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
    supportsTools: true,
    supportsImageInput: false,
    supportsImageGeneration: false,
    supportsFileInput: false,
    sortOrder: 0,
  });

  const handleSubmit = async () => {
    if (!form.apiName.trim() || !form.uiName.trim()) {
      toast.error("API name and display name are required");
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
          <div className="space-y-1.5">
            <Label htmlFor="apiName">API Model Name</Label>
            <Input
              id="apiName"
              placeholder="e.g. gpt-4.1 or openai/gpt-4.1"
              value={form.apiName}
              onChange={(e) =>
                setForm((f) => ({ ...f, apiName: e.target.value }))
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
              placeholder="e.g. GPT-4.1"
              value={form.uiName}
              onChange={(e) =>
                setForm((f) => ({ ...f, uiName: e.target.value }))
              }
            />
            <p className="text-xs text-muted-foreground">
              Name shown in the chat model selector.
            </p>
          </div>

          <div className="space-y-3 pt-1">
            <p className="text-sm font-medium">Capabilities</p>
            {CAPABILITY_SWITCHES.map(({ key, label, description }) => (
              <div
                key={key}
                className="flex items-center justify-between gap-4"
              >
                <div>
                  <p className="text-sm">{label}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
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
