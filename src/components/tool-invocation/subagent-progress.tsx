"use client";

import { memo, useMemo, useState, useEffect } from "react";
import { ToolUIPart, UIMessage } from "ai";
import {
  BotIcon,
  ChevronDownIcon,
  CheckCircle2Icon,
  HammerIcon,
  Loader2Icon,
} from "lucide-react";
import { cn } from "lib/utils";
import { TextShimmer } from "ui/text-shimmer";
import { Markdown } from "@/components/markdown";
import { Separator } from "ui/separator";
import { extractSubAgentNameFromToolName } from "lib/ai/agent/subagent-utils";

interface SubAgentProgressProps {
  part: ToolUIPart;
}

function SubAgentProgressInner({ part }: SubAgentProgressProps) {
  const { state, input, output } = part;
  const preliminary = (part as any).preliminary as boolean | undefined;

  // Execution states
  const isPending = state === "input-streaming";
  const isRunning = state === "input-available";
  const isStreaming = state === "output-available" && preliminary === true;
  const isComplete = state === "output-available" && !preliminary;
  const isError = state === "output-error";
  const isActive = isPending || isRunning || isStreaming;

  // Auto-expand while active, collapse when done
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    if (isComplete) setExpanded(false);
  }, [isComplete]);

  const subagentName = useMemo(
    () => extractSubAgentNameFromToolName((part as any).toolName) ?? "Subagent",
    [(part as any).toolName],
  );

  const task = useMemo(() => (input as any)?.task ?? "", [input]);

  // The accumulated UIMessage from readUIMessageStream
  const outputMessage = useMemo<UIMessage | null>(() => {
    if (!output) return null;
    return output as UIMessage;
  }, [output]);

  // Separate parts from the subagent's message
  const nestedTextParts = useMemo(() => {
    if (!outputMessage) return [];
    return outputMessage.parts.filter((p) => p.type === "text");
  }, [outputMessage]);

  const nestedToolParts = useMemo(() => {
    if (!outputMessage) return [];
    return outputMessage.parts.filter(
      (p) =>
        p.type === "tool-invocation" ||
        p.type === "tool-call" ||
        p.type.startsWith("tool-"),
    );
  }, [outputMessage]);

  const streamingText = useMemo(() => {
    const last = nestedTextParts.at(-1);
    return last?.type === "text" ? last.text : null;
  }, [nestedTextParts]);

  const stepCount = useMemo(() => nestedToolParts.length, [nestedToolParts]);

  return (
    <div className="group w-full flex flex-col fade-in duration-300 animate-in">
      {/* Header row */}
      <div
        className="flex gap-2 items-center cursor-pointer group/title select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Icon */}
        <div
          className={cn(
            "p-1.5 rounded transition-colors",
            isActive
              ? "text-primary bg-primary/10"
              : isError
                ? "text-destructive bg-destructive/10"
                : "text-muted-foreground bg-input/40",
          )}
        >
          {isActive ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : isError ? (
            <BotIcon className="size-3.5" />
          ) : (
            <CheckCircle2Icon className="size-3.5 text-green-500" />
          )}
        </div>

        {/* Name + status */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-semibold text-sm truncate">{subagentName}</span>
          <span className="text-xs text-muted-foreground shrink-0">
            {isPending || isRunning ? (
              <TextShimmer>Starting...</TextShimmer>
            ) : isStreaming ? (
              stepCount > 0 ? (
                <TextShimmer>
                  {`${stepCount} step${stepCount !== 1 ? "s" : ""}...`}
                </TextShimmer>
              ) : (
                <TextShimmer>Thinking...</TextShimmer>
              )
            ) : isError ? (
              <span className="text-destructive">Failed</span>
            ) : (
              <span className="text-green-600 dark:text-green-400">Done</span>
            )}
          </span>
        </div>

        {/* Chevron */}
        <div className="group-hover/title:bg-input p-1.5 rounded transition-colors duration-200 shrink-0">
          <ChevronDownIcon
            className={cn(
              "size-3.5 transition-transform duration-200",
              expanded && "rotate-180",
            )}
          />
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="flex gap-2 pt-2 pb-1">
          <div className="w-7 flex justify-center shrink-0">
            <Separator
              orientation="vertical"
              className="h-full bg-gradient-to-b from-border to-transparent"
            />
          </div>

          <div className="w-full min-w-0 flex flex-col gap-2">
            {/* Task card */}
            {task && (
              <div className="rounded-lg bg-card border px-4 py-3 text-xs">
                <p className="text-muted-foreground font-medium mb-1">Task</p>
                <p className="text-foreground break-words leading-relaxed">
                  {task}
                </p>
              </div>
            )}

            {/* Live tool calls from the subagent */}
            {nestedToolParts.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {nestedToolParts.map((p, i) => {
                  const tp = p as any;
                  const tName = tp.toolName ?? tp.name ?? tp.type ?? "tool";
                  const tState = tp.state ?? tp.status ?? "";
                  const tDone =
                    tState === "output-available" || tState === "result";
                  return (
                    <div
                      key={tp.toolCallId ?? i}
                      className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/40 border text-xs"
                    >
                      {tDone ? (
                        <CheckCircle2Icon className="size-3 shrink-0 text-green-500" />
                      ) : (
                        <Loader2Icon className="size-3 shrink-0 animate-spin text-primary" />
                      )}
                      <HammerIcon className="size-3 shrink-0 text-muted-foreground" />
                      <span className="font-mono text-muted-foreground truncate">
                        {tName}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Streaming / final text */}
            {streamingText && (
              <div className="rounded-lg bg-card border px-4 py-3">
                <p className="text-muted-foreground font-medium text-xs mb-2">
                  {isComplete ? "Response" : "Thinking..."}
                </p>
                <div className="text-sm leading-relaxed">
                  {isComplete ? (
                    <Markdown>{streamingText}</Markdown>
                  ) : (
                    <TextShimmer className="text-sm text-left">
                      {streamingText.length > 160
                        ? "…" + streamingText.slice(-160)
                        : streamingText}
                    </TextShimmer>
                  )}
                </div>
              </div>
            )}

            {/* Idle running state — no output yet */}
            {isRunning && !streamingText && nestedToolParts.length === 0 && (
              <div className="rounded-lg bg-card border px-4 py-3 text-xs">
                <TextShimmer>Initializing subagent...</TextShimmer>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const SubAgentProgress = memo(SubAgentProgressInner, (prev, next) => {
  const pp = prev.part as any;
  const np = next.part as any;
  return (
    pp.state === np.state &&
    pp.output === np.output &&
    pp.preliminary === np.preliminary
  );
});
SubAgentProgress.displayName = "SubAgentProgress";
