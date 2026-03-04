"use client";

import { Fragment, useState } from "react";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";
import { ModelProviderIcon } from "ui/model-provider-icon";
import { CheckIcon, ChevronDown, BrainCircuitIcon } from "lucide-react";
import { cn } from "lib/utils";
import { toast } from "sonner";
import { mutateKnowledge } from "@/hooks/queries/use-knowledge";
import { useKnowledgeModels } from "@/hooks/queries/use-knowledge-models";
import { useRouter } from "next/navigation";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NONE_VALUE = "__none__";

function parseModelValue(
  val: string,
): { provider: string; apiName: string } | null {
  if (!val || val === NONE_VALUE) return null;
  const idx = val.indexOf("::");
  if (idx === -1) return null;
  return { provider: val.slice(0, idx), apiName: val.slice(idx + 2) };
}

function makeModelValue(provider: string, apiName: string) {
  return `${provider}::${apiName}`;
}

interface ModelSelectorProps {
  value: string;
  onValueChange: (v: string) => void;
  providers: {
    provider: string;
    displayName: string;
    hasAPIKey: boolean;
    models: { uiName: string; apiName: string }[];
  }[];
  placeholder: string;
  allowNone?: boolean;
  noneLabel?: string;
}

function ModelSelector({
  value,
  onValueChange,
  providers,
  placeholder,
  allowNone,
  noneLabel = "None",
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const parsed = parseModelValue(value);

  const displayLabel = parsed
    ? parsed.apiName
    : value === NONE_VALUE
      ? noneLabel
      : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-between h-9 px-3 font-normal text-sm"
        >
          <div className="flex items-center gap-2 min-w-0">
            {parsed?.provider ? (
              <ModelProviderIcon
                provider={parsed.provider}
                className="size-3.5 shrink-0"
              />
            ) : null}
            <span className="truncate text-left">{displayLabel}</span>
          </div>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[280px]" align="start">
        <Command className="rounded-lg shadow-md h-72">
          <CommandInput placeholder="Search model..." />
          <CommandList className="p-1">
            <CommandEmpty>No models found.</CommandEmpty>
            {allowNone && (
              <>
                <CommandItem
                  value={NONE_VALUE}
                  onSelect={() => {
                    onValueChange(NONE_VALUE);
                    setOpen(false);
                  }}
                  className="cursor-pointer"
                >
                  <span className="text-muted-foreground">{noneLabel}</span>
                  {value === NONE_VALUE && (
                    <CheckIcon className="ml-auto size-3.5" />
                  )}
                </CommandItem>
                <CommandSeparator />
              </>
            )}
            {providers.map((p, i) => (
              <Fragment key={p.provider}>
                <CommandGroup
                  heading={
                    <div className="flex items-center gap-1.5">
                      <ModelProviderIcon
                        provider={p.provider}
                        className="size-3"
                      />
                      <span>{p.displayName}</span>
                    </div>
                  }
                  className={cn("pb-2", !p.hasAPIKey && "opacity-50")}
                >
                  {p.models.map((m) => {
                    const v = makeModelValue(p.provider, m.apiName);
                    return (
                      <CommandItem
                        key={v}
                        value={`${p.provider} ${m.uiName} ${m.apiName}`}
                        disabled={!p.hasAPIKey}
                        onSelect={() => {
                          onValueChange(v);
                          setOpen(false);
                        }}
                        className="cursor-pointer"
                      >
                        <span className="truncate">{m.uiName}</span>
                        {value === v && (
                          <CheckIcon className="ml-auto size-3.5 shrink-0" />
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
                {i < providers.length - 1 && <CommandSeparator />}
              </Fragment>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
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
