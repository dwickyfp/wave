"use client";

import { useState } from "react";
import { KnowledgeSummary } from "app-types/knowledge";
import { Button } from "ui/button";
import { Label } from "ui/label";
import { Switch } from "ui/switch";
import { BrainIcon, PlusIcon, Trash2Icon, LayersIcon } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";
import { fetcher } from "lib/utils";
import useSWR from "swr";
import { Badge } from "ui/badge";

interface Props {
  agentId?: string;
  knowledgeGroups: KnowledgeSummary[];
  enabled: boolean;
  onChange: (groups: KnowledgeSummary[], enabled: boolean) => void;
  hasEditAccess?: boolean;
}

export function KnowledgeAgentSection({
  knowledgeGroups,
  enabled,
  onChange,
  hasEditAccess = true,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: availableGroups } = useSWR<KnowledgeSummary[]>(
    "/api/knowledge?filters=mine,shared",
    fetcher,
  );

  const selectedIds = new Set(knowledgeGroups.map((g) => g.id));

  const handleToggle = (checked: boolean) => {
    onChange(knowledgeGroups, checked);
  };

  const handleAdd = (group: KnowledgeSummary) => {
    if (!selectedIds.has(group.id)) {
      onChange([...knowledgeGroups, group], enabled);
    }
    setPickerOpen(false);
  };

  const handleRemove = (groupId: string) => {
    onChange(
      knowledgeGroups.filter((g) => g.id !== groupId),
      enabled,
    );
  };

  const unselected = (availableGroups ?? []).filter(
    (g) => !selectedIds.has(g.id),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <Label className="text-base">Knowledge</Label>
          <p className="text-xs text-muted-foreground">
            Attach ContextX knowledge groups to this agent
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={!hasEditAccess}
        />
      </div>

      {enabled && (
        <div className="flex flex-col gap-2">
          {knowledgeGroups.map((group) => (
            <div
              key={group.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-secondary/40 border border-transparent hover:border-input transition-colors"
            >
              <div className="flex items-center justify-center size-7 rounded-md bg-primary/10 text-primary shrink-0">
                <BrainIcon className="size-3.5" />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-sm font-medium truncate">
                  {group.name}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground truncate">
                    {group.documentCount} docs · {group.chunkCount} chunks
                  </span>
                </div>
              </div>
              {hasEditAccess && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 hover:text-destructive shrink-0"
                  onClick={() => handleRemove(group.id)}
                >
                  <Trash2Icon className="size-3" />
                </Button>
              )}
            </div>
          ))}

          {hasEditAccess && (
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="border-dashed gap-2 mt-1">
                  <PlusIcon className="size-3.5" />
                  Add Knowledge Group
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-72" align="start">
                <Command>
                  <CommandInput placeholder="Search knowledge groups..." />
                  <CommandEmpty>No groups found</CommandEmpty>
                  <CommandGroup className="max-h-60 overflow-y-auto">
                    {unselected.map((group) => (
                      <CommandItem
                        key={group.id}
                        value={group.name}
                        onSelect={() => handleAdd(group)}
                        className="flex items-center gap-2"
                      >
                        <BrainIcon className="size-3.5 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm truncate">{group.name}</span>
                          <div className="flex gap-1 mt-0.5">
                            <Badge
                              variant="secondary"
                              className="text-xs px-1 py-0"
                            >
                              <LayersIcon className="size-2.5 mr-0.5" />
                              {group.chunkCount}
                            </Badge>
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                    {unselected.length === 0 && (
                      <div className="px-3 py-6 text-xs text-center text-muted-foreground">
                        All available groups are already added
                      </div>
                    )}
                  </CommandGroup>
                </Command>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}
    </div>
  );
}
