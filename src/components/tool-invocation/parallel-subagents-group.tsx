"use client";

import { memo, useEffect, useRef, useState } from "react";
import { ToolUIPart } from "ai";
import { ChevronDownIcon, ZapIcon } from "lucide-react";
import { cn } from "lib/utils";
import { SubAgentProgress } from "./subagent-progress";

interface ParallelSubAgentsGroupProps {
  parts: ToolUIPart[];
}

function ParallelSubAgentsGroupInner({ parts }: ParallelSubAgentsGroupProps) {
  const allComplete = parts.every((p) => {
    const preliminary = (p as any).preliminary as boolean | undefined;
    return (
      (p.state === "output-available" && !preliminary) ||
      p.state === "output-error"
    );
  });

  const anyActive = parts.some((p) => {
    const preliminary = (p as any).preliminary as boolean | undefined;
    return (
      p.state === "input-streaming" ||
      p.state === "input-available" ||
      (p.state === "output-available" && preliminary === true)
    );
  });

  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    if (allComplete) setExpanded(false);
  }, [allComplete]);

  // Track which subagent was most recently active (yielded last)
  const [lastActiveIdx, setLastActiveIdx] = useState<number | null>(null);
  const prevOutputsRef = useRef<unknown[]>(parts.map((p) => p.output));

  useEffect(() => {
    parts.forEach((p, i) => {
      if (p.output !== prevOutputsRef.current[i]) {
        setLastActiveIdx(i);
        prevOutputsRef.current[i] = p.output;
      }
    });
  });

  // Clear "last active" highlight shortly after all complete
  useEffect(() => {
    if (!allComplete) return;
    const t = setTimeout(() => setLastActiveIdx(null), 1200);
    return () => clearTimeout(t);
  }, [allComplete]);

  const count = parts.length;
  const label = allComplete
    ? `${count} agents complete`
    : `${count} agents running in parallel`;

  return (
    <div className="w-full flex flex-col fade-in duration-300 animate-in">
      {/* Group header */}
      <div
        className="flex gap-2 items-center cursor-pointer group/title select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <div
          className={cn(
            "p-1.5 rounded transition-colors",
            anyActive
              ? "text-primary bg-primary/10"
              : "text-muted-foreground bg-input/40",
          )}
        >
          <ZapIcon
            className={cn(
              "size-3.5 transition-colors",
              anyActive && "fill-primary/60",
            )}
          />
        </div>

        <span className="font-semibold text-sm flex-1 min-w-0">{label}</span>

        <div className="group-hover/title:bg-input p-1.5 rounded transition-colors duration-200 shrink-0">
          <ChevronDownIcon
            className={cn(
              "size-3.5 transition-transform duration-200",
              expanded && "rotate-180",
            )}
          />
        </div>
      </div>

      {/* Agent cards */}
      {expanded && (
        <div className="mt-2 flex flex-col gap-2 pl-7">
          {parts.map((part, i) => {
            const isLastActive = lastActiveIdx === i;
            const isPartActive = (() => {
              const preliminary = (part as any).preliminary as
                | boolean
                | undefined;
              return (
                part.state === "input-streaming" ||
                part.state === "input-available" ||
                (part.state === "output-available" && preliminary === true)
              );
            })();

            return (
              <div
                key={(part as any).toolCallId ?? i}
                className={cn(
                  "rounded-lg border bg-card transition-all duration-300",
                  isLastActive && "ring-2 ring-primary/30 border-primary/30",
                  isPartActive && !isLastActive && "border-border",
                  !isPartActive && "border-border/60 opacity-90",
                )}
              >
                <div className="px-3 pt-3 pb-2">
                  <SubAgentProgress part={part} compact />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const ParallelSubAgentsGroup = memo(
  ParallelSubAgentsGroupInner,
  (prev, next) => {
    if (prev.parts.length !== next.parts.length) return false;
    return prev.parts.every((p, i) => {
      const np = next.parts[i] as any;
      const pp = p as any;
      return (
        pp.state === np.state &&
        pp.output === np.output &&
        pp.preliminary === np.preliminary
      );
    });
  },
);
ParallelSubAgentsGroup.displayName = "ParallelSubAgentsGroup";
