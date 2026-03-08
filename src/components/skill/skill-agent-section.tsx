"use client";

import { useState } from "react";
import { SkillSummary } from "app-types/skill";
import { Button } from "ui/button";
import { Label } from "ui/label";
import { Switch } from "ui/switch";
import { PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react";
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

interface SkillAgentSectionProps {
  skills: SkillSummary[];
  enabled: boolean;
  onChange: (skills: SkillSummary[], enabled: boolean) => void;
  hasEditAccess?: boolean;
}

export function SkillAgentSection({
  skills,
  enabled,
  onChange,
  hasEditAccess = true,
}: SkillAgentSectionProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: availableSkills } = useSWR<SkillSummary[]>(
    "/api/skill?filters=mine,shared",
    fetcher,
  );

  const selectedIds = new Set(skills.map((skill) => skill.id));
  const unselected = (availableSkills ?? []).filter(
    (skill) => !selectedIds.has(skill.id),
  );

  const handleToggle = (checked: boolean) => {
    onChange(skills, checked);
  };

  const handleAdd = (skill: SkillSummary) => {
    if (!selectedIds.has(skill.id)) {
      onChange([...skills, skill], enabled);
    }
    setPickerOpen(false);
  };

  const handleRemove = (skillId: string) => {
    onChange(
      skills.filter((skill) => skill.id !== skillId),
      enabled,
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <Label className="text-base">Skills</Label>
          <p className="text-xs text-muted-foreground">
            Attach reusable skills to this agent
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
          {skills.map((skill) => (
            <div
              key={skill.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-secondary/40 border border-transparent hover:border-input transition-colors"
            >
              <div className="flex items-center justify-center size-7 rounded-md bg-primary/10 text-primary shrink-0">
                <SparklesIcon className="size-3.5" />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-sm font-medium truncate">
                  {skill.title}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {skill.description || "No description"}
                </span>
              </div>
              <Badge variant="secondary" className="capitalize text-xs">
                {skill.visibility}
              </Badge>
              {hasEditAccess && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 hover:text-destructive shrink-0"
                  onClick={() => handleRemove(skill.id)}
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
                  Add Skill
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-80" align="start">
                <Command>
                  <CommandInput placeholder="Search skills..." />
                  <CommandEmpty>No skills found</CommandEmpty>
                  <CommandGroup className="max-h-60 overflow-y-auto">
                    {unselected.map((skill) => (
                      <CommandItem
                        key={skill.id}
                        value={`${skill.title} ${skill.description ?? ""}`}
                        onSelect={() => handleAdd(skill)}
                      >
                        <div className="flex items-start gap-2 w-full">
                          <SparklesIcon className="size-3.5 mt-0.5 text-primary shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm truncate">{skill.title}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {skill.description || "No description"}
                            </p>
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                    {unselected.length === 0 && (
                      <div className="px-3 py-6 text-xs text-center text-muted-foreground">
                        All available skills are already added
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
