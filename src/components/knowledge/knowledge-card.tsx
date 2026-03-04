"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { Badge } from "ui/badge";
import { format } from "date-fns";
import {
  BrainIcon,
  FileIcon,
  LayersIcon,
  LockIcon,
  GlobeIcon,
  EyeIcon,
} from "lucide-react";
import Link from "next/link";
import { KnowledgeSummary } from "app-types/knowledge";
import { cn } from "lib/utils";

const VISIBILITY_ICONS = {
  private: LockIcon,
  public: GlobeIcon,
  readonly: EyeIcon,
};

interface KnowledgeCardProps {
  group: KnowledgeSummary;
  isOwner: boolean;
}

export function KnowledgeCard({ group, isOwner }: KnowledgeCardProps) {
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
              <Badge
                variant="secondary"
                className="text-xs gap-1 px-1.5 py-0.5"
              >
                <LayersIcon className="size-3" />
                {group.chunkCount} chunks
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
        </CardFooter>
      </Card>
    </Link>
  );
}
