"use client";

import { useCopy } from "@/hooks/use-copy";
import { createDebounce } from "lib/utils";
import { CheckIcon, CopyIcon, ExpandIcon, Loader } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { ScrollArea } from "ui/scroll-area";
import {
  createMermaidRenderConfig,
  normalizeMermaidSvg,
  readMermaidThemePalette,
} from "./mermaid-diagram.render";
import { renderDetailedMermaidPresentationDiagram } from "./mermaid-diagram.presentation";
import {
  formatMermaidError,
  prepareMermaidChart,
} from "./mermaid-diagram.utils";

let mermaidModule: typeof import("mermaid").default | null = null;

const loadMermaid = async () => {
  if (!mermaidModule) {
    mermaidModule = (await import("mermaid")).default;
  }
  return mermaidModule;
};

interface MermaidDiagramProps {
  chart?: string;
}

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const { copied, copy } = useCopy();
  const { resolvedTheme } = useTheme();
  const [state, setState] = useState<{
    height: number | null;
    svg: string;
    error: string | null;
    loading: boolean;
    mode: "detailed-presentation" | "mermaid" | null;
    width: number | null;
  }>({
    height: null,
    svg: "",
    error: null,
    loading: true,
    mode: null,
    width: null,
  });
  const [isExpanded, setIsExpanded] = useState(false);
  const previousRenderKeyRef = useRef<string | null>(null);
  const debounce = useMemo(() => createDebounce(), []);

  useEffect(() => {
    const renderKey = `${resolvedTheme ?? "system"}::${chart ?? ""}`;

    if (previousRenderKeyRef.current !== renderKey) {
      setState((prev) => ({
        ...prev,
        error: null,
        loading: true,
      }));
      previousRenderKeyRef.current = renderKey;
    }

    let cancelled = false;

    debounce(async () => {
      if (!chart?.trim()) {
        if (!cancelled) {
          setState({
            height: null,
            svg: "",
            error: null,
            loading: false,
            mode: null,
            width: null,
          });
        }
        return;
      }

      try {
        const preparedChart = prepareMermaidChart(chart);

        if ("error" in preparedChart) {
          if (!cancelled) {
            setState({
              height: null,
              svg: "",
              error: preparedChart.error,
              loading: false,
              mode: null,
              width: null,
            });
          }
          return;
        }

        const palette = readMermaidThemePalette({ resolvedTheme });
        const detailedPresentation = renderDetailedMermaidPresentationDiagram({
          chart: preparedChart.chart,
          palette,
        });

        if (detailedPresentation) {
          if (!cancelled) {
            setState({
              height: detailedPresentation.height,
              svg: detailedPresentation.svg,
              error: null,
              loading: false,
              mode: "detailed-presentation",
              width: detailedPresentation.width,
            });
          }
          return;
        }

        const mermaid = await loadMermaid();

        mermaid.initialize(createMermaidRenderConfig({ palette }));

        await mermaid.parse(preparedChart.chart);

        const id = `mermaid-${Date.now()}`;
        const { svg } = await mermaid.render(id, preparedChart.chart);
        const normalizedDiagram = normalizeMermaidSvg(svg);

        if (!cancelled) {
          setState({
            height: normalizedDiagram.height,
            svg: normalizedDiagram.svg,
            error: null,
            loading: false,
            mode: "mermaid",
            width: normalizedDiagram.width,
          });
        }
      } catch (err) {
        console.error("Mermaid rendering error:", err);

        if (!cancelled) {
          setState({
            height: null,
            svg: "",
            error: formatMermaidError(err, chart),
            loading: false,
            mode: null,
            width: null,
          });
        }
      }
    }, 500);

    return () => {
      cancelled = true;
      debounce.clear();
    };
  }, [chart, resolvedTheme, debounce]);

  const isDetailedPresentation = state.mode === "detailed-presentation";
  const dialogCanvasStyle =
    isDetailedPresentation && state.width !== null
      ? {
          margin: "0 auto",
          maxWidth: `${Math.ceil(state.width)}px`,
          width: "100%",
        }
      : {
          width:
            state.width !== null
              ? `max(100%, ${Math.ceil(state.width)}px)`
              : "100%",
        };

  const hasRenderedDiagram = !state.loading && !state.error && !!state.svg;

  return (
    <>
      <div
        data-mermaid-block="true"
        data-mermaid-mode={state.mode ?? "pending"}
        data-mermaid-state={
          state.loading ? "loading" : state.error ? "error" : "ready"
        }
        className="my-4 overflow-hidden rounded-[1.5rem] border bg-background shadow-sm"
      >
        <div className="flex items-center gap-2 border-b bg-muted/20 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-[0.7rem] font-semibold tracking-[0.22em] text-muted-foreground uppercase">
              Mermaid
            </p>
            <p className="text-xs text-muted-foreground">
              {state.mode === "detailed-presentation"
                ? "Detailed flow diagram"
                : "Detailed diagram viewer"}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant={copied ? "secondary" : "ghost"}
              className="size-8 rounded-full"
              aria-label="Copy Mermaid source"
              onClick={() => copy(chart ?? "")}
            >
              {copied ? (
                <CheckIcon className="size-4" />
              ) : (
                <CopyIcon className="size-4" />
              )}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 rounded-full"
              aria-label="Expand diagram"
              disabled={!hasRenderedDiagram}
              onClick={() => setIsExpanded(true)}
            >
              <ExpandIcon className="size-4" />
            </Button>
          </div>
        </div>

        <div className="overflow-hidden px-3 pb-3 pt-3 sm:px-4 sm:pb-4 sm:pt-4">
          {state.loading ? (
            <div className="flex h-40 w-full items-center justify-center">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                Rendering diagram <Loader className="size-4 animate-spin" />
              </div>
            </div>
          ) : state.error ? (
            <div className="space-y-3 text-destructive">
              <p className="text-sm font-medium">
                Error rendering Mermaid diagram
              </p>
              <pre className="overflow-auto rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-xs whitespace-pre-wrap">
                {state.error}
              </pre>
              <pre className="overflow-auto rounded-2xl border bg-accent/40 p-4 text-xs text-foreground whitespace-pre-wrap">
                {chart}
              </pre>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="mx-auto min-w-full" style={{ width: "100%" }}>
                <div
                  className="transition-opacity duration-200"
                  dangerouslySetInnerHTML={{ __html: state.svg }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={isExpanded} onOpenChange={setIsExpanded}>
        <DialogContent
          className={
            isDetailedPresentation
              ? "h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] gap-0 overflow-hidden border-none p-0"
              : "w-[min(96vw,1400px)] max-w-[min(96vw,1400px)] gap-0 overflow-hidden border-none p-0"
          }
        >
          <DialogHeader className="border-b bg-muted/20 px-6 py-5">
            <DialogTitle>
              {state.mode === "detailed-presentation"
                ? "Detailed flow diagram"
                : "Mermaid diagram"}
            </DialogTitle>
            <DialogDescription>
              Expanded view keeps the diagram at its natural canvas size inside
              a scrollable viewer.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea
            className={
              isDetailedPresentation
                ? "h-[calc(100vh-8.5rem)] w-full"
                : "h-[min(82vh,900px)] w-full"
            }
            showHorizontalScrollbar={isDetailedPresentation}
          >
            <div
              className={
                isDetailedPresentation
                  ? "bg-[color-mix(in_oklab,var(--background)_98%,var(--muted)_2%)] p-1 sm:p-2"
                  : "bg-[color-mix(in_oklab,var(--background)_98%,var(--muted)_2%)] p-3 sm:p-4"
              }
            >
              <div
                className={
                  isDetailedPresentation
                    ? "rounded-[1rem] bg-background p-1 shadow-sm sm:p-2"
                    : "rounded-[1.25rem] border bg-background p-3 shadow-sm sm:p-4"
                }
                style={{
                  minHeight:
                    !isDetailedPresentation && state.height
                      ? `${Math.ceil(state.height)}px`
                      : undefined,
                }}
              >
                {hasRenderedDiagram ? (
                  <div
                    className={isDetailedPresentation ? "mx-auto" : undefined}
                    style={dialogCanvasStyle}
                  >
                    <div dangerouslySetInnerHTML={{ __html: state.svg }} />
                  </div>
                ) : null}
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
