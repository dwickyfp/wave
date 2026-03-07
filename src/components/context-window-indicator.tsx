"use client";

import { cn } from "@/lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "ui/hover-card";

interface ContextWindowIndicatorProps {
  className?: string;
  totalTokens: number;
  usedTokens: number;
}

const INDICATOR_SIZE = 18;
const INDICATOR_RADIUS = 7;
const INDICATOR_CIRCUMFERENCE = 2 * Math.PI * INDICATOR_RADIUS;

export function ContextWindowIndicator({
  className,
  totalTokens,
  usedTokens,
}: ContextWindowIndicatorProps) {
  if (!totalTokens || totalTokens < 1) return null;

  const usageRatio = usedTokens / totalTokens;
  const clampedRatio = Math.min(Math.max(usageRatio, 0), 1);
  const strokeDashoffset = INDICATOR_CIRCUMFERENCE * (1 - clampedRatio);
  const displayPercent = Math.round(clampedRatio * 100);
  const remainingPercent = 100 - displayPercent;
  const indicatorClassName =
    usageRatio >= 0.9
      ? "text-destructive"
      : usageRatio >= 0.75
        ? "text-amber-500"
        : "text-muted-foreground";
  const progressBarClassName =
    usageRatio >= 0.9
      ? "bg-destructive"
      : usageRatio >= 0.75
        ? "bg-amber-500"
        : "bg-primary";

  return (
    <HoverCard openDelay={120} closeDelay={120}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={`Estimated context usage ${displayPercent}% used, ${remainingPercent}% left`}
          className={cn(
            "mr-1 inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-input hover:text-foreground",
            className,
          )}
        >
          <svg
            width={INDICATOR_SIZE}
            height={INDICATOR_SIZE}
            viewBox={`0 0 ${INDICATOR_SIZE} ${INDICATOR_SIZE}`}
            className="overflow-visible"
            aria-hidden="true"
          >
            <circle
              cx={INDICATOR_SIZE / 2}
              cy={INDICATOR_SIZE / 2}
              r={INDICATOR_RADIUS}
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.18"
              strokeWidth="2"
            />
            <circle
              cx={INDICATOR_SIZE / 2}
              cy={INDICATOR_SIZE / 2}
              r={INDICATOR_RADIUS}
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2"
              className={cn("origin-center -rotate-90", indicatorClassName)}
              strokeDasharray={INDICATOR_CIRCUMFERENCE}
              strokeDashoffset={strokeDashoffset}
            />
          </svg>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        align="end"
        side="top"
        className="w-[280px] border-border/70 p-0"
      >
        <div className="px-4 py-3 text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Context Window
          </p>
          <p className="mt-2 text-lg font-semibold text-foreground">
            {displayPercent}% used ({remainingPercent}% left)
          </p>
          <p className="mt-2 text-sm text-foreground">
            {formatTokenCount(usedTokens)} / {formatTokenCount(totalTokens)}{" "}
            tokens used
          </p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-border/70">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-200",
                progressBarClassName,
              )}
              style={{ width: `${Math.min(clampedRatio * 100, 100)}%` }}
            />
          </div>
          <p className="mt-4 text-[11px] leading-4 text-muted-foreground">
            Estimated from the current thread, draft, mentions, and pending
            files.
          </p>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${formatCompactNumber(tokens / 1_000_000)}m`;
  }

  if (tokens >= 1_000) {
    return `${formatCompactNumber(tokens / 1_000)}k`;
  }

  return tokens.toLocaleString();
}

function formatCompactNumber(value: number): string {
  if (value >= 100) return Math.round(value).toString();

  return value.toFixed(1).replace(/\.0$/, "");
}
