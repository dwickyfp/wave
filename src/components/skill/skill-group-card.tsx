"use client";

import type { SkillGroupSummary, SkillVisibility } from "app-types/skill";
import { format } from "date-fns";
import {
  CheckIcon,
  EyeIcon,
  FolderKanbanIcon,
  GlobeIcon,
  Loader2Icon,
  LockIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

const VISIBILITY_ICONS = {
  private: LockIcon,
  readonly: EyeIcon,
  public: GlobeIcon,
};

const VISIBILITY_OPTIONS: Array<{
  value: SkillVisibility;
  label: string;
  description: string;
}> = [
  {
    value: "private",
    label: "Private",
    description: "Only you can access this group",
  },
  {
    value: "readonly",
    label: "Read-only",
    description: "Others can use but cannot edit this group",
  },
  {
    value: "public",
    label: "Public",
    description: "Others can access and edit this group",
  },
];

interface SkillGroupCardProps {
  group: SkillGroupSummary;
  isOwner: boolean;
  onDelete?: (groupId: string) => void;
  onVisibilityChange?: (groupId: string, visibility: SkillVisibility) => void;
  isVisibilityChangeLoading?: boolean;
  isDeleteLoading?: boolean;
}

export function SkillGroupCard({
  group,
  isOwner,
  onDelete,
  onVisibilityChange,
  isVisibilityChangeLoading = false,
  isDeleteLoading = false,
}: SkillGroupCardProps) {
  const VisIcon = VISIBILITY_ICONS[group.visibility];

  return (
    <Link href={`/skills/groups/${group.id}`} title={group.name}>
      <Card className="w-full min-h-[196px] transition-colors group flex flex-col hover:bg-input/40 cursor-pointer">
        <CardHeader className="pb-2 overflow-hidden">
          <CardTitle className="flex items-center justify-between gap-2 min-w-0 overflow-hidden">
            <div className="flex min-w-0 w-0 flex-1 gap-2 overflow-hidden items-center">
              <div className="size-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <FolderKanbanIcon className="size-4" />
              </div>
              <div className="min-w-0 flex-1 overflow-hidden">
                <p
                  className="font-medium block w-full min-w-0 truncate text-sm"
                  data-testid="skill-group-card-title"
                  title={group.name}
                >
                  {group.name}
                </p>
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <time>
                    {format(group.updatedAt || new Date(), "MMM d, yyyy")}
                  </time>
                  <VisIcon className="size-3" />
                </div>
              </div>
            </div>
          </CardTitle>
        </CardHeader>

        <CardContent className="grow">
          <p className="text-xs text-muted-foreground line-clamp-3 break-words">
            {group.description || "No description"}
          </p>
        </CardContent>

        <CardFooter className="pt-0 pb-3">
          <div className="flex items-center justify-between w-full gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="capitalize text-xs">
                {group.visibility}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {group.skillCount} skills
              </Badge>
            </div>

            {isOwner && (
              <div className="flex items-center gap-1">
                {onVisibilityChange && (
                  <DropdownMenu>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              disabled={isVisibilityChangeLoading}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                            >
                              {isVisibilityChangeLoading ? (
                                <Loader2Icon className="size-4 animate-spin" />
                              ) : (
                                <VisIcon className="size-4" />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>Change visibility</TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent className="max-w-sm">
                      {VISIBILITY_OPTIONS.map((item) => {
                        const Icon = VISIBILITY_ICONS[item.value];
                        const isActive = group.visibility === item.value;

                        return (
                          <DropdownMenuItem
                            key={item.value}
                            disabled={isVisibilityChangeLoading || isActive}
                            onClick={() =>
                              onVisibilityChange(group.id, item.value)
                            }
                          >
                            <Icon className="size-4" />
                            <div className="flex flex-col px-3 py-1 gap-0.5">
                              <p className="text-sm">{item.label}</p>
                              <p className="text-xs text-muted-foreground">
                                {item.description}
                              </p>
                            </div>
                            {isActive && (
                              <CheckIcon className="size-4 ml-auto" />
                            )}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {onDelete && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 hover:text-destructive"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onDelete(group.id);
                        }}
                        disabled={isDeleteLoading}
                      >
                        {isDeleteLoading ? (
                          <Loader2Icon className="size-4 animate-spin" />
                        ) : (
                          <Trash2Icon className="size-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete group</TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}
          </div>
        </CardFooter>
      </Card>
    </Link>
  );
}
