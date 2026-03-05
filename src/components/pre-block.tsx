"use client";

import { useCopy } from "@/hooks/use-copy";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { cn } from "lib/utils";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import type { JSX } from "react";
import { Fragment, useLayoutEffect, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import {
  type BundledLanguage,
  bundledLanguages,
  codeToHast,
} from "shiki/bundle/web";
import { safe } from "ts-safe";
import { Button } from "ui/button";
import JsonView from "ui/json-view";

// Dynamically import MermaidDiagram component
const MermaidDiagram = dynamic(
  () => import("./mermaid-diagram").then((mod) => mod.MermaidDiagram),
  {
    loading: () => (
      <div className="text-sm flex bg-accent/30 flex-col rounded-2xl relative my-4 overflow-hidden border">
        <div className="w-full flex z-20 py-2 px-4 items-center">
          <span className="text-sm text-muted-foreground">mermaid</span>
        </div>
        <div className="relative overflow-x-auto px-6 pb-6">
          <div className="h-20 w-full flex items-center justify-center">
            <span className="text-muted-foreground">
              Loading Mermaid renderer...
            </span>
          </div>
        </div>
      </div>
    ),
    ssr: false,
  },
);

// Dynamically import VegaLiteChart component
const VegaLiteChart = dynamic(
  () => import("./vegalite-chart").then((mod) => mod.VegaLiteChart),
  {
    loading: () => (
      <div className="text-sm flex bg-accent/30 flex-col rounded-2xl relative my-4 overflow-hidden border">
        <div className="w-full flex z-20 py-2 px-4 items-center">
          <span className="text-sm text-muted-foreground">vega-lite</span>
        </div>
        <div className="relative overflow-x-auto px-6 pb-6">
          <div className="h-40 w-full flex items-center justify-center">
            <span className="text-muted-foreground">
              Loading chart renderer...
            </span>
          </div>
        </div>
      </div>
    ),
    ssr: false,
  },
);

const PurePre = ({
  children,
  className,
  code,
  lang,
}: {
  children: any;
  className?: string;
  code: string;
  lang: string;
}) => {
  const { copied, copy } = useCopy();

  return (
    <pre className={cn("relative", className)}>
      <div className="p-1.5 border-b mb-4 z-20 bg-secondary">
        <div className="w-full flex z-20 py-0.5 px-4 items-center">
          <span className="text-sm text-muted-foreground">{lang}</span>
          <Button
            size="icon"
            variant={copied ? "secondary" : "ghost"}
            className="ml-auto z-10 p-3! size-2! rounded-sm"
            onClick={() => {
              copy(code);
            }}
          >
            {copied ? <CheckIcon /> : <CopyIcon className="size-3!" />}
          </Button>
        </div>
      </div>

      <div className="relative overflow-x-auto px-6 pb-6">{children}</div>
    </pre>
  );
};

export async function Highlight(
  code: string,
  lang: BundledLanguage | (string & {}),
  theme: string,
) {
  const parsed: BundledLanguage = (
    bundledLanguages[lang] ? lang : "md"
  ) as BundledLanguage;

  if (lang === "json") {
    return (
      <PurePre code={code} lang={lang}>
        <JsonView data={code} initialExpandDepth={3} />
      </PurePre>
    );
  }

  if (lang === "mermaid") {
    return (
      <PurePre code={code} lang={lang}>
        <MermaidDiagram chart={code} />
      </PurePre>
    );
  }

  if (lang === "vegalite" || lang === "vega-lite") {
    return (
      <div className="px-4 py-3">
        <VegaLiteChart spec={code} />
      </div>
    );
  }

  const out = await codeToHast(code, {
    lang: parsed,
    theme,
  });

  return toJsxRuntime(out, {
    Fragment,
    jsx,
    jsxs,
    components: {
      pre: (props) => <PurePre {...props} code={code} lang={lang} />,
    },
  }) as JSX.Element;
}

export function PreBlock({ children }: { children: any }) {
  const code = children.props.children;
  const { theme } = useTheme();
  const language = children.props.className?.split("-")?.[1] || "bash";
  const [loading, setLoading] = useState(true);
  const [component, setComponent] = useState<JSX.Element | null>(
    <PurePre className="animate-pulse" code={code} lang={language}>
      {children}
    </PurePre>,
  );

  useLayoutEffect(() => {
    safe()
      .map(() =>
        Highlight(
          code,
          language,
          theme == "dark" ? "dark-plus" : "github-light",
        ),
      )
      .ifOk(setComponent)
      .watch(() => setLoading(false));
  }, [theme, language, code]);

  // For other code blocks, render as before
  return (
    <div
      className={cn(
        loading && "animate-pulse",
        "text-sm flex bg-secondary/40 shadow border flex-col rounded relative my-4 overflow-hidden",
      )}
    >
      {component}
    </div>
  );
}

/**
 * Snowflake-specific pre-block renderer.
 * - `vegalite` / `vega-lite` → VegaLiteChart (same as default)
 * - `json` containing a Vega-Lite `$schema` → VegaLiteChart
 * - `mermaid` → disabled; falls through to generic syntax-highlighted code
 */
export function SnowflakePreBlock({ children }: { children: any }) {
  const code = children.props.children;
  const { theme } = useTheme();
  const rawLang = children.props.className?.split("-")?.[1] || "bash";

  // Promote JSON blocks that are Vega-Lite specs to the vegalite renderer
  const isVegaJson =
    rawLang === "json" &&
    typeof code === "string" &&
    code.includes('"$schema"') &&
    code.includes("vega-lite");
  const language = isVegaJson ? "vegalite" : rawLang;

  const [loading, setLoading] = useState(true);
  const [component, setComponent] = useState<JSX.Element | null>(
    <PurePre className="animate-pulse" code={code} lang={language}>
      {children}
    </PurePre>,
  );

  useLayoutEffect(() => {
    safe()
      .map(() =>
        // For snowflake: treat mermaid as plain text (no mermaid diagrams)
        language === "mermaid"
          ? Highlight(
              code,
              "md",
              theme == "dark" ? "dark-plus" : "github-light",
            )
          : Highlight(
              code,
              language,
              theme == "dark" ? "dark-plus" : "github-light",
            ),
      )
      .ifOk(setComponent)
      .watch(() => setLoading(false));
  }, [theme, language, code]);

  return (
    <div
      className={cn(
        loading && "animate-pulse",
        "text-sm flex bg-secondary/40 shadow border flex-col rounded relative my-4 overflow-hidden",
      )}
    >
      {component}
    </div>
  );
}
