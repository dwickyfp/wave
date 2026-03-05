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
  PencilIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Textarea } from "ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

const VISIBILITY_ICONS = {
  private: LockIcon,
  public: GlobeIcon,
  readonly: EyeIcon,
};

interface KnowledgeCardProps {
  group: KnowledgeSummary;
  isOwner: boolean;
  onEditGroup?: (
    groupId: string,
    data: { name: string; description: string },
  ) => Promise<void>;
  isEditLoading?: boolean;
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
  onEditGroup,
  isEditLoading = false,
  onVisibilityChange,
  isVisibilityChangeLoading = false,
}: KnowledgeCardProps) {
  const VisIcon = VISIBILITY_ICONS[group.visibility];
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(group.name);
  const [editDescription, setEditDescription] = useState(
    group.description || "",
  );

  const openEditDialog = () => {
    setEditName(group.name);
    setEditDescription(group.description || "");
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!onEditGroup) return;

    const name = editName.trim();
    const description = editDescription.trim();

    if (!name) {
      toast.error("Name is required");
      return;
    }

    await onEditGroup(group.id, { name, description });
    setEditOpen(false);
  };

  return (
    <>
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
                {isOwner && onEditGroup && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-foreground"
                        data-testid="knowledge-edit-button"
                        disabled={isEditLoading}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openEditDialog();
                        }}
                      >
                        {isEditLoading ? (
                          <Loader2Icon className="size-4 animate-spin" />
                        ) : (
                          <PencilIcon className="size-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Edit group</TooltipContent>
                  </Tooltip>
                )}

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

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Knowledge Group</DialogTitle>
            <DialogDescription>
              Update the group name and description.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`kg-edit-name-${group.id}`}>
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id={`kg-edit-name-${group.id}`}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleEditSave()}
                placeholder="Knowledge group name"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`kg-edit-desc-${group.id}`}>Description</Label>
              <Textarea
                id={`kg-edit-desc-${group.id}`}
                rows={3}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={isEditLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleEditSave()}
              disabled={isEditLoading}
            >
              {isEditLoading ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
