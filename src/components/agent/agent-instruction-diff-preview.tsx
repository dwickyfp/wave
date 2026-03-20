"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { cn } from "lib/utils";
import {
  buildInstructionDiff,
  type InstructionDiffLine,
} from "lib/agent/instruction-diff";

function getLineClassName(line: InstructionDiffLine) {
  if (line.type === "added") {
    return "border-l-2 border-emerald-500/40 bg-emerald-500/10";
  }

  if (line.type === "removed") {
    return "border-l-2 border-amber-500/30 bg-muted/40 text-muted-foreground line-through";
  }

  return "border-l-2 border-transparent";
}

export function AgentInstructionDiffPreview({
  before,
  after,
  className,
}: {
  before: string;
  after: string;
  className?: string;
}) {
  const t = useTranslations();
  const diff = useMemo(
    () => buildInstructionDiff(before, after),
    [before, after],
  );

  return (
    <div
      className={cn("rounded-lg border bg-secondary/20", className)}
      data-testid="agent-instruction-diff-preview"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <p className="text-sm font-medium">
            {t("Agent.instructionsAiReviewTitle")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("Agent.instructionsAiReviewDescription")}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-emerald-500/70" />
            {t("Agent.instructionsAiLegendAdded")}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-amber-500/70" />
            {t("Agent.instructionsAiLegendRemoved")}
          </span>
        </div>
      </div>

      {diff.hasChanges ? (
        <div className="max-h-72 overflow-y-auto p-3">
          <div className="space-y-1">
            {diff.lines.map((line) => (
              <div
                key={line.key}
                className={cn(
                  "grid grid-cols-[28px_minmax(0,1fr)] gap-3 rounded-md px-3 py-2 font-mono text-xs leading-5",
                  getLineClassName(line),
                )}
                data-testid={`agent-instruction-diff-line-${line.type}`}
              >
                <span className="select-none text-muted-foreground">
                  {line.type === "added"
                    ? "+"
                    : line.type === "removed"
                      ? "-"
                      : " "}
                </span>
                <span className="whitespace-pre-wrap break-words">
                  {line.text || " "}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          {t("Agent.instructionsAiNoChanges")}
        </p>
      )}
    </div>
  );
}
