"use client";

import { useMemo, useState } from "react";
import {
  AgentSkillAttachment,
  SkillGroupSummary,
  SkillSummary,
} from "app-types/skill";
import { Button } from "ui/button";
import { Label } from "ui/label";
import { Switch } from "ui/switch";
import {
  FolderKanbanIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
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
  skillGroups: SkillGroupSummary[];
  enabled: boolean;
  onChange: (
    skills: SkillSummary[],
    skillGroups: SkillGroupSummary[],
    enabled: boolean,
  ) => void;
  hasEditAccess?: boolean;
}

export function SkillAgentSection({
  skills,
  skillGroups,
  enabled,
  onChange,
  hasEditAccess = true,
}: SkillAgentSectionProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data: availableSkills } = useSWR<SkillSummary[]>(
    "/api/skill?filters=mine,shared",
    fetcher,
  );
  const { data: availableGroups } = useSWR<SkillGroupSummary[]>(
    "/api/skill-group?filters=mine,shared",
    fetcher,
  );

  const selectedSkillIds = useMemo(
    () => new Set(skills.map((skill) => skill.id)),
    [skills],
  );
  const selectedGroupIds = useMemo(
    () => new Set(skillGroups.map((group) => group.id)),
    [skillGroups],
  );
  const unselectedSkills = (availableSkills ?? []).filter(
    (skill) => !selectedSkillIds.has(skill.id),
  );
  const unselectedGroups = (availableGroups ?? []).filter(
    (group) => !selectedGroupIds.has(group.id),
  );
  const selectedItems: AgentSkillAttachment[] = [
    ...skillGroups.map((group) => ({ kind: "group" as const, ...group })),
    ...skills.map((skill) => ({ kind: "skill" as const, ...skill })),
  ];

  const handleToggle = (checked: boolean) => {
    onChange(skills, skillGroups, checked);
  };

  const handleAddSkill = (skill: SkillSummary) => {
    if (!selectedSkillIds.has(skill.id)) {
      onChange([...skills, skill], skillGroups, enabled);
    }
    setPickerOpen(false);
  };

  const handleAddGroup = (group: SkillGroupSummary) => {
    if (!selectedGroupIds.has(group.id)) {
      onChange(skills, [...skillGroups, group], enabled);
    }
    setPickerOpen(false);
  };

  const handleRemove = (item: AgentSkillAttachment) => {
    if (item.kind === "group") {
      onChange(
        skills,
        skillGroups.filter((group) => group.id !== item.id),
        enabled,
      );
      return;
    }

    onChange(
      skills.filter((skill) => skill.id !== item.id),
      skillGroups,
      enabled,
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <Label className="text-base">Skills</Label>
          <p className="text-xs text-muted-foreground">
            Attach reusable skills or skill groups to this agent
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
          {selectedItems.map((item) => (
            <div
              key={`${item.kind}:${item.id}`}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-secondary/40 border border-transparent hover:border-input transition-colors"
            >
              <div className="flex items-center justify-center size-7 rounded-md bg-primary/10 text-primary shrink-0">
                {item.kind === "group" ? (
                  <FolderKanbanIcon className="size-3.5" />
                ) : (
                  <SparklesIcon className="size-3.5" />
                )}
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-sm font-medium truncate">
                  {item.kind === "group" ? item.name : item.title}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {item.kind === "group"
                    ? item.description || `${item.skillCount} linked skills`
                    : item.description || "No description"}
                </span>
              </div>
              <Badge variant="outline" className="text-xs capitalize">
                {item.kind}
              </Badge>
              <Badge variant="secondary" className="capitalize text-xs">
                {item.visibility}
              </Badge>
              {hasEditAccess && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 hover:text-destructive shrink-0"
                  onClick={() => handleRemove(item)}
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
                  Add Skill or Group
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-80" align="start">
                <Command>
                  <CommandInput placeholder="Search skills or groups..." />
                  <CommandEmpty>No skills or groups found</CommandEmpty>
                  <CommandGroup
                    heading="Skill Groups"
                    className="max-h-72 overflow-y-auto"
                  >
                    {unselectedGroups.map((group) => (
                      <CommandItem
                        key={group.id}
                        value={`${group.name} ${group.description ?? ""}`}
                        onSelect={() => handleAddGroup(group)}
                      >
                        <div className="flex items-start gap-2 w-full">
                          <FolderKanbanIcon className="size-3.5 mt-0.5 text-primary shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm truncate">{group.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {group.description ||
                                `${group.skillCount} linked skills`}
                            </p>
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                    {unselectedGroups.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        All available groups are already added
                      </div>
                    )}
                  </CommandGroup>
                  <CommandGroup
                    heading="Skills"
                    className="max-h-72 overflow-y-auto"
                  >
                    {unselectedSkills.map((skill) => (
                      <CommandItem
                        key={skill.id}
                        value={`${skill.title} ${skill.description ?? ""}`}
                        onSelect={() => handleAddSkill(skill)}
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
                    {unselectedSkills.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
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
