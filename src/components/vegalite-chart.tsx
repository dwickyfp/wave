"use client";

import embed from "vega-embed";
import { Loader } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

interface VegaLiteChartProps {
  spec: string;
}

export function VegaLiteChart({ spec }: VegaLiteChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    const render = async () => {
      try {
        setLoading(true);
        setError(null);

        const parsedSpec = JSON.parse(spec);

        // Normalise $schema to v6 — Snowflake returns v5 specs but the
        // installed vega-lite is v6, which logs a warning if $schema mismatches.
        if (
          typeof parsedSpec.$schema === "string" &&
          parsedSpec.$schema.includes("vega-lite")
        ) {
          parsedSpec.$schema =
            "https://vega.github.io/schema/vega-lite/v6.json";
        }

        // Apply theme overrides
        const isDark = resolvedTheme === "dark";
        const themeConfig = isDark
          ? {
              background: "transparent",
              axis: {
                labelColor: "#a1a1aa",
                titleColor: "#a1a1aa",
                gridColor: "#27272a",
                domainColor: "#3f3f46",
                tickColor: "#3f3f46",
              },
              legend: {
                labelColor: "#a1a1aa",
                titleColor: "#a1a1aa",
              },
              title: {
                color: "#f4f4f5",
              },
            }
          : {
              background: "transparent",
            };

        const specWithTheme = {
          ...parsedSpec,
          config: {
            ...(parsedSpec.config ?? {}),
            ...themeConfig,
          },
          background: "transparent",
          width: "container" as unknown as number,
          autosize: { type: "fit" as const, contains: "padding" as const },
        };

        if (cancelled || !containerRef.current) return;

        await embed(containerRef.current, specWithTheme, {
          actions: false,
          renderer: "svg",
          theme: isDark ? "dark" : undefined,
        });

        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Failed to render chart";
          // Incomplete JSON arrives while the stream is still in progress.
          // Keep the loading spinner visible rather than flashing an error.
          const isIncompleteJson =
            message.includes("Unexpected end of JSON") ||
            message.includes("Unterminated string in JSON");
          if (!isIncompleteJson) {
            setError(message);
            setLoading(false);
          }
        }
      }
    };

    render();

    return () => {
      cancelled = true;
    };
  }, [spec, resolvedTheme]);

  if (error) {
    return (
      <div className="p-4 text-destructive text-sm rounded-md bg-destructive/10">
        <p className="font-medium">Failed to render Vega-Lite chart</p>
        <p className="mt-1 text-xs opacity-80">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative w-full">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center h-40 w-full">
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            Rendering chart <Loader className="size-4 animate-spin" />
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className="w-full"
        style={{ visibility: loading ? "hidden" : "visible" }}
      />
    </div>
  );
}
