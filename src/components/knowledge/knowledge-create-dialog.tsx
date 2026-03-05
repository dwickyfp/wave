"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "ui/dialog";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Textarea } from "ui/textarea";
import { BrainCircuitIcon } from "lucide-react";
import { toast } from "sonner";
import { mutateKnowledge } from "@/hooks/queries/use-knowledge";
import { useKnowledgeModels } from "@/hooks/queries/use-knowledge-models";
import { useRouter } from "next/navigation";
import {
  ModelSelector,
  parseModelValue,
  makeModelValue,
  NONE_VALUE,
} from "./knowledge-model-selector";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KnowledgeCreateDialog({ open, onOpenChange }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const { data: modelsData } = useKnowledgeModels();

  const [form, setForm] = useState({
    name: "",
    description: "",
    embeddingValue: "",
    rerankingValue: NONE_VALUE,
    retrievalThreshold: 0,
  });

  // Resolve effective embedding value: prefer form state, else first available model
  const embeddingValue =
    form.embeddingValue ||
    (modelsData?.embeddingProviders[0]?.models[0]
      ? makeModelValue(
          modelsData.embeddingProviders[0].provider,
          modelsData.embeddingProviders[0].models[0].apiName,
        )
      : "");

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }

    const embedding = parseModelValue(embeddingValue);
    if (!embedding) {
      toast.error("Please select an embedding model");
      return;
    }

    const reranking = parseModelValue(form.rerankingValue);

    setLoading(true);
    try {
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          visibility: "private",
          embeddingProvider: embedding.provider,
          embeddingModel: embedding.apiName,
          rerankingProvider: reranking?.provider ?? null,
          rerankingModel: reranking?.apiName ?? null,
          retrievalThreshold: form.retrievalThreshold,
        }),
      });

      if (!res.ok) throw new Error("Failed to create knowledge group");

      const group = await res.json();
      await mutateKnowledge();
      onOpenChange(false);
      setForm({
        name: "",
        description: "",
        embeddingValue: "",
        rerankingValue: NONE_VALUE,
        retrievalThreshold: 0,
      });
      toast.success(`"${group.name}" created`);
      router.push(`/knowledge/${group.id}`);
    } catch {
      toast.error("Failed to create knowledge group");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New Knowledge Group</DialogTitle>
          <DialogDescription className="sr-only">
            Create a new knowledge group to store and retrieve documents
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kg-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="kg-name"
              placeholder="e.g. Engineering Docs"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kg-desc">
              Description{" "}
              <span className="text-muted-foreground text-xs font-normal">
                (optional)
              </span>
            </Label>
            <Textarea
              id="kg-desc"
              placeholder="What kind of documents will this group contain?"
              rows={2}
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
            />
          </div>

          {/* AI Models */}
          <div className="flex flex-col gap-3 rounded-lg border p-3 bg-muted/30">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <BrainCircuitIcon className="size-3.5" />
              <span>AI Models</span>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">
                  Embedding
                </Label>
                <ModelSelector
                  value={embeddingValue}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, embeddingValue: v }))
                  }
                  providers={modelsData?.embeddingProviders ?? []}
                  placeholder="Select embedding model"
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">
                  Reranker <span className="font-normal">(optional)</span>
                </Label>
                <ModelSelector
                  value={form.rerankingValue}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, rerankingValue: v }))
                  }
                  providers={modelsData?.rerankingProviders ?? []}
                  placeholder="Select reranker"
                  allowNone
                  noneLabel="No reranker"
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">
                  Retrieval Threshold{" "}
                  <span className="font-normal">(0 = off)</span>
                </Label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={form.retrievalThreshold}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        retrievalThreshold: Number(e.target.value),
                      }))
                    }
                    className="flex-1 h-1.5 accent-primary"
                  />
                  <span className="text-xs font-mono w-8 text-right">
                    {form.retrievalThreshold.toFixed(2)}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Minimum relevance score to return a result
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
