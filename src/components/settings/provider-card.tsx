"use client";

import { LlmProviderConfig } from "app-types/settings";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { cn } from "lib/utils";
import { Settings2, CheckCircle2, Key, ChevronRight } from "lucide-react";
import { ProviderDefinition } from "./provider-definitions";

interface ProviderCardProps {
  def: ProviderDefinition;
  provider: LlmProviderConfig | null;
  onConfigure: () => void;
}

export function ProviderCard({
  def,
  provider,
  onConfigure,
}: ProviderCardProps) {
  const hasApiKey = !def.needsApiKey || !!provider?.apiKeyMasked;
  const hasBaseUrl = !def.needsBaseUrl || !!provider?.baseUrl?.trim();
  const hasRequiredCustomSettings = (def.customFields ?? [])
    .filter((field) => field.required)
    .every((field) => {
      const value = provider?.settings?.[field.key];
      if (field.type === "boolean") return typeof value === "boolean";
      if (field.type === "number") return typeof value === "number";
      return typeof value === "string" && value.trim().length > 0;
    });
  const isConfigured =
    !!provider && hasApiKey && hasBaseUrl && hasRequiredCustomSettings;
  const isInDb = !!provider;
  const enabledModelCount =
    provider?.models.filter((m) => m.enabled).length ?? 0;

  return (
    <div
      className={cn(
        "relative flex flex-col gap-3 rounded-xl border bg-card p-4 transition-all hover:shadow-md hover:border-primary/30",
        isInDb && !provider.enabled && "opacity-60",
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex size-10 items-center justify-center rounded-lg text-sm font-bold",
              def.color,
              def.textColor,
            )}
          >
            {def.initials}
          </div>
          <div>
            <p className="font-medium text-sm leading-tight">
              {def.displayName}
            </p>
            {isInDb && !provider!.enabled && (
              <Badge variant="secondary" className="text-xs mt-0.5">
                Disabled
              </Badge>
            )}
          </div>
        </div>

        {isConfigured ? (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-500 mt-0.5" />
        ) : (
          <Key className="size-4 shrink-0 text-muted-foreground/40 mt-0.5" />
        )}
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground leading-snug line-clamp-2">
        {def.description}
      </p>

      {/* Stats row */}
      <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-2 mt-auto">
        <span>
          {isInDb
            ? `${enabledModelCount} model${enabledModelCount !== 1 ? "s" : ""}`
            : "No models yet"}
        </span>
        <Badge
          variant={isConfigured ? "default" : "outline"}
          className="text-[10px] px-1.5 py-0"
        >
          {isConfigured ? "Configured" : "Not set"}
        </Badge>
      </div>

      {/* Configure button */}
      <Button
        variant={isConfigured ? "outline" : "default"}
        size="sm"
        className="w-full gap-1.5 mt-1"
        onClick={onConfigure}
      >
        {isConfigured ? (
          <>
            <Settings2 className="size-3.5" />
            Configure
          </>
        ) : (
          <>
            <Key className="size-3.5" />
            Set up
          </>
        )}
        <ChevronRight className="size-3.5 ml-auto" />
      </Button>
    </div>
  );
}
