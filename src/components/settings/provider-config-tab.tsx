"use client";

import useSWR, { mutate as swrMutate } from "swr";
import { fetcher } from "lib/utils";
import { LlmProviderConfig } from "app-types/settings";
import { ProviderCard } from "./provider-card";
import { Button } from "ui/button";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Skeleton } from "ui/skeleton";
import { ProviderConfigSheet } from "./provider-config-sheet";
import {
  PROVIDER_DEFINITIONS,
  ProviderDefinition,
  getProviderDef,
} from "./provider-definitions";

const PROVIDERS_KEY = "/api/settings/providers";
const CHAT_MODELS_KEY = "/api/chat/models";

export function ProviderConfigTab() {
  const { data: providers, isLoading } = useSWR<LlmProviderConfig[]>(
    PROVIDERS_KEY,
    fetcher,
  );
  const [selectedProvider, setSelectedProvider] =
    useState<LlmProviderConfig | null>(null);
  // For predefined providers not yet in DB
  const [addingWithDef, setAddingWithDef] = useState<ProviderDefinition | null>(
    null,
  );
  // For fully custom providers
  const [addingCustom, setAddingCustom] = useState(false);

  // Merge all predefined providers with DB data, then append any custom ones
  const allProviderSlots = useMemo(() => {
    const slots = PROVIDER_DEFINITIONS.map((def) => ({
      def,
      provider: providers?.find((p) => p.name === def.name) ?? null,
    }));

    // Append custom providers from DB that are not in the predefined list
    const customDbProviders =
      providers?.filter(
        (p) => !PROVIDER_DEFINITIONS.some((def) => def.name === p.name),
      ) ?? [];
    customDbProviders.forEach((p) => {
      slots.push({ def: getProviderDef(p.name), provider: p });
    });

    return slots;
  }, [providers]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Configure API keys and register models for each provider.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => setAddingCustom(true)}
          >
            <Plus className="size-3.5" />
            Custom Provider
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {allProviderSlots.map(({ def, provider }) => (
          <ProviderCard
            key={def.name}
            def={def}
            provider={provider}
            onConfigure={() => {
              if (provider) {
                setSelectedProvider(provider);
              } else {
                setAddingWithDef(def);
              }
            }}
          />
        ))}
      </div>

      {/* Configure existing provider */}
      {selectedProvider && (
        <ProviderConfigSheet
          provider={selectedProvider}
          open={!!selectedProvider}
          onClose={() => {
            setSelectedProvider(null);
            swrMutate(PROVIDERS_KEY);
            swrMutate(CHAT_MODELS_KEY);
          }}
        />
      )}

      {/* Configure predefined provider not yet in DB */}
      {addingWithDef && (
        <ProviderConfigSheet
          provider={null}
          prefillName={addingWithDef.name}
          prefillDisplayName={addingWithDef.displayName}
          open={!!addingWithDef}
          onClose={() => {
            setAddingWithDef(null);
            swrMutate(PROVIDERS_KEY);
            swrMutate(CHAT_MODELS_KEY);
          }}
        />
      )}

      {/* Add fully custom provider */}
      {addingCustom && (
        <ProviderConfigSheet
          provider={null}
          open={addingCustom}
          onClose={() => {
            setAddingCustom(false);
            swrMutate(PROVIDERS_KEY);
            swrMutate(CHAT_MODELS_KEY);
          }}
        />
      )}
    </div>
  );
}
