"use client";

import { Fragment, useState } from "react";
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
import { Button } from "ui/button";
import { CheckIcon, ChevronDown } from "lucide-react";
import { cn } from "lib/utils";

export const NONE_VALUE = "__none__";

export function parseModelValue(
  val: string,
): { provider: string; apiName: string } | null {
  if (!val || val === NONE_VALUE) return null;
  const idx = val.indexOf("::");
  if (idx === -1) return null;
  return { provider: val.slice(0, idx), apiName: val.slice(idx + 2) };
}

export function makeModelValue(provider: string, apiName: string) {
  return `${provider}::${apiName}`;
}

export interface ModelSelectorProvider {
  provider: string;
  displayName: string;
  hasAPIKey: boolean;
  models: { uiName: string; apiName: string }[];
}

export interface ModelSelectorProps {
  value: string;
  onValueChange: (v: string) => void;
  providers: ModelSelectorProvider[];
  placeholder: string;
  allowNone?: boolean;
  noneLabel?: string;
}

export function ModelSelector({
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
