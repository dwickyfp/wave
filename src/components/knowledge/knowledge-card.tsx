"use client";

import { KnowledgeSummary, KnowledgeVisibility } from "app-types/knowledge";
import { format } from "date-fns";
import { cn } from "lib/utils";
import {
  BrainIcon,
  CheckIcon,
  EyeIcon,
  FileIcon,
  GlobeIcon,
  Loader2Icon,
  LockIcon,
} from "lucide-react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

const VISIBILITY_ICONS = {
  private: LockIcon,
  public: GlobeIcon,
  readonly: EyeIcon,
};

interface KnowledgeCardProps {
  group: KnowledgeSummary;
  isOwner: boolean;
  onVisibilityChange?: (
    groupId: string,
    visibility: KnowledgeVisibility,
  ) => void;
  isVisibilityChangeLoading?: boolean;
}

const VISIBILITY_OPTIONS: Array<{
  value: KnowledgeVisibility;
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
    description: "Others can read but not modify",
  },
  {
    value: "public",
    label: "Public",
    description: "Anyone can access this group",
  },
];

export function KnowledgeCard({
  group,
  isOwner,
  onVisibilityChange,
  isVisibilityChangeLoading = false,
}: KnowledgeCardProps) {
  const VisIcon = VISIBILITY_ICONS[group.visibility];

  return (
    <Link href={`/knowledge/${group.id}`} title={group.name}>
      <Card
        className="w-full min-h-[196px] @container transition-colors group flex flex-col gap-3 cursor-pointer hover:bg-input"
        data-testid="knowledge-card"
      >
        <CardHeader className="shrink gap-y-0">
          <CardTitle className="flex gap-3 items-stretch min-w-0">
            <div
              style={{ backgroundColor: group.icon?.style?.backgroundColor }}
              className={cn(
                "p-2 rounded-lg flex items-center justify-center ring ring-background border shrink-0",
                !group.icon?.style?.backgroundColor && "bg-primary/10",
              )}
            >
              {group.icon?.value ? (
                <Avatar className="size-6">
                  <AvatarImage src={group.icon.value} />
                  <AvatarFallback>{group.name[0]}</AvatarFallback>
                </Avatar>
              ) : (
                <BrainIcon className="size-5 text-primary" />
              )}
            </div>

            <div className="flex flex-col justify-around min-w-0 flex-1 overflow-hidden">
              <span className="truncate font-medium">{group.name}</span>
              <div className="text-xs text-muted-foreground flex items-center gap-1.5 min-w-0">
                <time className="shrink-0">
                  {format(group.updatedAt || new Date(), "MMM d, yyyy")}
                </time>
                <VisIcon className="size-3 shrink-0" />
              </div>
            </div>
          </CardTitle>
        </CardHeader>

        <CardContent className="min-h-0 grow">
          <CardDescription className="text-xs line-clamp-3 break-words overflow-hidden">
            {group.description || "No description"}
          </CardDescription>
        </CardContent>

        <CardFooter className="shrink min-h-0 overflow-visible">
          <div className="flex items-center justify-between w-full gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge
                variant="secondary"
                className="text-xs gap-1 px-1.5 py-0.5"
              >
                <FileIcon className="size-3" />
                {group.documentCount} docs
              </Badge>
              {group.mcpEnabled && (
                <Badge
                  variant="outline"
                  className="text-xs px-1.5 py-0.5 border-green-500 text-green-600"
                >
                  MCP
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-1 min-w-0">
              {isOwner && onVisibilityChange && (
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 data-[state=open]:bg-input text-muted-foreground hover:text-foreground"
                            data-testid="knowledge-visibility-button"
                            disabled={isVisibilityChangeLoading}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
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
                          className="cursor-pointer"
                          disabled={isActive || isVisibilityChangeLoading}
                          data-testid={`knowledge-visibility-${item.value}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onVisibilityChange(group.id, item.value);
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <Icon className="size-4" />
                            <div className="flex flex-col gap-0.5">
                              <p className="text-sm">{item.label}</p>
                              <p className="text-xs text-muted-foreground">
                                {item.description}
                              </p>
                            </div>
                          </div>
                          {isActive && (
                            <CheckIcon className="ml-auto size-4 text-primary" />
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {!isOwner && group.userName && (
                <div className="flex items-center gap-1 min-w-0">
                  <Avatar className="size-4 ring shrink-0 rounded-full">
                    <AvatarImage src={group.userAvatar || undefined} />
                    <AvatarFallback>
                      {group.userName[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs text-muted-foreground truncate min-w-0">
                    {group.userName}
                  </span>
                </div>
              )}
            </div>
          </div>
        </CardFooter>
      </Card>
    </Link>
  );
}
