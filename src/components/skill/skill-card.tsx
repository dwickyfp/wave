"use client";

import { SkillSummary, SkillVisibility } from "app-types/skill";
import { format } from "date-fns";
import {
  CheckIcon,
  EyeIcon,
  GlobeIcon,
  Loader2Icon,
  LockIcon,
  PencilIcon,
  Trash2Icon,
  WrenchIcon,
} from "lucide-react";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Card, CardFooter, CardHeader, CardTitle } from "ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { ResourceTeamShareDialog } from "../teams/resource-team-share-dialog";

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
    description: "Only you can access this skill",
  },
  {
    value: "readonly",
    label: "Read-only",
    description: "Others can use but cannot edit this skill",
  },
  {
    value: "public",
    label: "Public",
    description: "Others can access and edit this skill",
  },
];

interface SkillCardProps {
  skill: SkillSummary;
  isOwner: boolean;
  onEdit?: (skill: SkillSummary) => void;
  onDelete?: (skillId: string) => void;
  onVisibilityChange?: (skillId: string, visibility: SkillVisibility) => void;
  isVisibilityChangeLoading?: boolean;
  isDeleteLoading?: boolean;
}

export function SkillCard({
  skill,
  isOwner,
  onEdit,
  onDelete,
  onVisibilityChange,
  isVisibilityChangeLoading = false,
  isDeleteLoading = false,
}: SkillCardProps) {
  const VisIcon = VISIBILITY_ICONS[skill.visibility];
  const visibleTeamNames = (skill.sharedTeams ?? []).slice(0, 2);
  const hiddenTeamCount =
    (skill.sharedTeams?.length ?? 0) - visibleTeamNames.length;

  return (
    <Card className="w-full transition-colors group flex flex-col hover:bg-input/40">
      <CardHeader className="pb-2 overflow-hidden">
        <CardTitle className="flex items-center justify-between gap-2 min-w-0 overflow-hidden">
          <div className="flex min-w-0 w-0 flex-1 gap-2 overflow-hidden items-center">
            <div className="size-7 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <WrenchIcon className="size-3.5" />
            </div>
            <div className="min-w-0 flex-1 overflow-hidden">
              <p
                className="font-medium block w-full min-w-0 truncate text-sm"
                data-testid="skill-card-title"
                title={skill.title}
              >
                {skill.title}
              </p>
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <time>
                  {format(skill.updatedAt || new Date(), "MMM d, yyyy")}
                </time>
                <VisIcon className="size-3" />
                {visibleTeamNames.length ? (
                  <span className="truncate">
                    {visibleTeamNames.map((team) => team.name).join(", ")}
                    {hiddenTeamCount > 0 ? ` +${hiddenTeamCount}` : ""}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </CardTitle>
      </CardHeader>

      <CardFooter className="pt-0 pb-3">
        <div className="flex items-center justify-between w-full gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="capitalize text-xs">
              {skill.visibility}
            </Badge>
            {visibleTeamNames.map((team) => (
              <Badge
                key={team.id}
                variant="outline"
                className="max-w-full truncate text-xs"
              >
                {team.name}
              </Badge>
            ))}
            {hiddenTeamCount > 0 ? (
              <Badge variant="outline" className="text-xs">
                +{hiddenTeamCount} teams
              </Badge>
            ) : null}
          </div>

          {isOwner && (
            <div className="flex items-center gap-1">
              {onEdit && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => onEdit(skill)}
                    >
                      <PencilIcon className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Edit skill</TooltipContent>
                </Tooltip>
              )}

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
                      const isActive = skill.visibility === item.value;

                      return (
                        <DropdownMenuItem
                          key={item.value}
                          disabled={isVisibilityChangeLoading || isActive}
                          onClick={() =>
                            onVisibilityChange(skill.id, item.value)
                          }
                        >
                          <Icon className="size-4" />
                          <div className="flex flex-col px-3 py-1 gap-0.5">
                            <p className="text-sm">{item.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.description}
                            </p>
                          </div>
                          {isActive && <CheckIcon className="size-4 ml-auto" />}
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
                      onClick={() => onDelete(skill.id)}
                      disabled={isDeleteLoading}
                    >
                      {isDeleteLoading ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <Trash2Icon className="size-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Delete skill</TooltipContent>
                </Tooltip>
              )}

              <ResourceTeamShareDialog
                resourceType="skill"
                resourceId={skill.id}
                resourceName={skill.title}
              />
            </div>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
