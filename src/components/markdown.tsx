"use client";

import type { ChatKnowledgeCitation } from "app-types/chat";
import { isJson, isString, toAny } from "lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  LinkIcon,
} from "lucide-react";
import {
  Fragment,
  PropsWithChildren,
  memo,
  useDeferredValue,
  useMemo,
  useState,
  useCallback,
} from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Button } from "ui/button";
import JsonView from "ui/json-view";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { PreBlock, SnowflakePreBlock } from "./pre-block";
import { appStore } from "@/app/store";
import { linkifyKnowledgeCitationMarkers } from "lib/chat/knowledge-citations";

const FadeIn = memo(({ children }: PropsWithChildren) => {
  return <span className="fade-in animate-in duration-1000">{children} </span>;
});
FadeIn.displayName = "FadeIn";

export const WordByWordFadeIn = memo(({ children }: PropsWithChildren) => {
  const childrens = [children]
    .flat()
    .flatMap((child) => (isString(child) ? child.split(" ") : child));
  return childrens.map((word, index) =>
    isString(word) ? <FadeIn key={index}>{word}</FadeIn> : word,
  );
});
WordByWordFadeIn.displayName = "WordByWordFadeIn";

function renderMarkdownChildren(children: React.ReactNode, animate: boolean) {
  return animate ? <WordByWordFadeIn>{children}</WordByWordFadeIn> : children;
}

const TABLE_PAGE_SIZE = 10;

function transformMarkdownUrl(url: string) {
  if (url.startsWith("knowledge://")) {
    return url;
  }

  return defaultUrlTransform(url);
}

function getSourceAttrs(node?: any) {
  const start = node?.position?.start?.offset;
  const end = node?.position?.end?.offset;

  if (typeof start !== "number") {
    return {};
  }

  return {
    "data-source-start": String(start),
    ...(typeof end === "number" ? { "data-source-end": String(end) } : {}),
  };
}

// Lazy load XLSX library from CDN (same pattern as interactive-table)
const loadXLSX = async () => {
  if (typeof window === "undefined") {
    throw new Error("XLSX can only be loaded in browser environment");
  }
  if ((window as any).XLSX) return (window as any).XLSX;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
    script.onload = () => {
      if ((window as any).XLSX) resolve((window as any).XLSX);
      else reject(new Error("Failed to load XLSX library"));
    };
    script.onerror = () => reject(new Error("Failed to load XLSX script"));
    document.head.appendChild(script);
  });
};

// Helper: extract plain text from a HAST node
function hastToText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastToText).join("");
}

// Recursively render HAST nodes to React, preserving inline formatting
function renderHastNode(node: any): React.ReactNode {
  if (!node) return null;
  if (node.type === "text") return node.value;
  if (node.type === "element") {
    const children = node.children?.map((c: any, i: number) => (
      <Fragment key={i}>{renderHastNode(c)}</Fragment>
    ));
    switch (node.tagName) {
      case "strong":
        return <strong className="font-semibold">{children}</strong>;
      case "em":
        return <em>{children}</em>;
      case "code":
        return (
          <code className="text-sm rounded-md bg-accent text-primary py-0.5 px-1.5 mx-0.5">
            {children}
          </code>
        );
      case "a":
        return (
          <a
            href={node.properties?.href}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            {children}
          </a>
        );
      default:
        return <>{children}</>;
    }
  }
  return null;
}

const MarkdownTable = memo(
  ({ node, animate = true }: { node?: any; animate?: boolean }) => {
    const [page, setPage] = useState(1);
    const [exporting, setExporting] = useState(false);

    const theadNode = node?.children?.find((c: any) => c.tagName === "thead");
    const tbodyNode = node?.children?.find((c: any) => c.tagName === "tbody");

    const headerRow = theadNode?.children?.find((c: any) => c.tagName === "tr");
    const headerCells =
      headerRow?.children?.filter((c: any) => c.tagName === "th") || [];

    const allRows =
      tbodyNode?.children?.filter((c: any) => c.tagName === "tr") || [];
    const totalRows = allRows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / TABLE_PAGE_SIZE));
    const pageRows = allRows.slice(
      (page - 1) * TABLE_PAGE_SIZE,
      page * TABLE_PAGE_SIZE,
    );

    const exportToExcel = async () => {
      setExporting(true);
      try {
        const XLSX = await loadXLSX();

        const headers = headerCells.map((th: any) => hastToText(th));
        const rows = allRows.map((tr: any) =>
          (tr.children?.filter((c: any) => c.tagName === "td") ?? []).map(
            (td: any) => hastToText(td),
          ),
        );

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);

        const colWidths = headers.map((h: string, i: number) => ({
          wch: Math.min(
            Math.max(
              h.length,
              ...rows.map((r: string[]) => String(r[i] ?? "").length),
            ) + 2,
            50,
          ),
        }));
        worksheet["!cols"] = colWidths;

        XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
        XLSX.writeFile(workbook, "table_data.xlsx");
      } catch (err) {
        console.error("Excel export failed:", err);
      } finally {
        setExporting(false);
      }
    };

    return (
      <div className="my-4 border rounded-xl overflow-hidden">
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/20">
          <span className="text-sm font-medium">List Data</span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={exportToExcel}
            disabled={exporting}
          >
            <FileSpreadsheet className="size-3.5" />
            {exporting ? "Exporting..." : "Export to Excel"}
          </Button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                {headerCells.map((th: any, i: number) => (
                  <TableHead
                    key={i}
                    className="whitespace-normal break-words align-top [overflow-wrap:anywhere]"
                  >
                    {renderMarkdownChildren(
                      th.children?.map((c: any, j: number) => (
                        <Fragment key={j}>{renderHastNode(c)}</Fragment>
                      )),
                      animate,
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((tr: any, rowIdx: number) => {
                const cells =
                  tr.children?.filter((c: any) => c.tagName === "td") || [];
                return (
                  <TableRow key={rowIdx}>
                    {cells.map((td: any, cellIdx: number) => (
                      <TableCell
                        key={cellIdx}
                        className="whitespace-normal break-words align-top [overflow-wrap:anywhere]"
                      >
                        {renderMarkdownChildren(
                          td.children?.map((c: any, j: number) => (
                            <Fragment key={j}>{renderHastNode(c)}</Fragment>
                          )),
                          animate,
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/20">
            <span className="text-xs text-muted-foreground">
              {totalRows} rows · Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <span className="text-xs px-2 text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  },
);
MarkdownTable.displayName = "MarkdownTable";

// ── Citation Link ──────────────────────────────────────────────────────────────
// Renders knowledge:// links (from retriever citations) as interactive badges
// that open the document preview panel in chat.
function CitationLink({
  href,
  children,
  citations,
}: {
  href: string;
  children: React.ReactNode;
  citations?: ChatKnowledgeCitation[];
}) {
  const parseKnowledgeHref = (
    value: string,
    availableCitations: ChatKnowledgeCitation[],
  ) => {
    try {
      const url = new URL(value);

      if (url.hostname === "citation") {
        const citationNumber = Number.parseInt(
          url.pathname.replace(/^\/+/, ""),
          10,
        );
        if (!Number.isFinite(citationNumber)) return null;
        const citation =
          availableCitations.find((item) => item.number === citationNumber) ??
          null;
        if (!citation) return null;

        return {
          documentId: citation.documentId,
          groupId: citation.groupId,
          documentName: citation.documentName,
          citationNumber: citation.number,
          versionId: citation.versionId ?? null,
          pageStart: citation.pageStart ?? null,
          pageEnd: citation.pageEnd ?? null,
          sectionHeading: citation.sectionHeading ?? null,
          excerpt: citation.excerpt ?? null,
          fallbackWarning: null,
        };
      }

      const groupId = decodeURIComponent(url.hostname);
      const documentId = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      if (!groupId || !documentId) return null;

      const pageStart = url.searchParams.get("pageStart");
      const pageEnd = url.searchParams.get("pageEnd");
      const citationNumber = url.searchParams.get("citationNumber");
      const matchedCitation =
        citationNumber && Number.isFinite(Number(citationNumber))
          ? (availableCitations.find(
              (item) => item.number === Number.parseInt(citationNumber, 10),
            ) ?? null)
          : null;

      return {
        groupId,
        documentId,
        documentName:
          url.searchParams.get("documentName") ??
          matchedCitation?.documentName ??
          "Document",
        versionId: url.searchParams.get("versionId"),
        sectionHeading:
          url.searchParams.get("sectionHeading") ??
          matchedCitation?.sectionHeading,
        excerpt: url.searchParams.get("excerpt") ?? matchedCitation?.excerpt,
        citationNumber:
          citationNumber && Number.isFinite(Number(citationNumber))
            ? Number(citationNumber)
            : undefined,
        pageStart:
          pageStart && Number.isFinite(Number(pageStart))
            ? Number(pageStart)
            : undefined,
        pageEnd:
          pageEnd && Number.isFinite(Number(pageEnd))
            ? Number(pageEnd)
            : undefined,
        fallbackWarning: null,
      };
    } catch {
      return null;
    }
  };

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const parsed = parseKnowledgeHref(href, citations ?? []);
      if (!parsed) return;

      appStore.setState({
        citationDocumentPreview: {
          documentId: parsed.documentId,
          groupId: parsed.groupId,
          documentName: parsed.documentName,
          citationNumber: parsed.citationNumber,
          versionId: parsed.versionId ?? null,
          pageStart: parsed.pageStart ?? null,
          pageEnd: parsed.pageEnd ?? null,
          sectionHeading: parsed.sectionHeading ?? null,
          excerpt: parsed.excerpt ?? null,
          fallbackWarning: parsed.fallbackWarning ?? null,
        },
      });
    },
    [href, citations],
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          className="inline-flex whitespace-nowrap align-super -translate-y-[0.18em] rounded-sm px-0.5 text-[0.72em] font-medium leading-none text-primary/75 no-underline transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
        >
          <span>{children}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        Open cited document
      </TooltipContent>
    </Tooltip>
  );
}

const buildComponents = (
  knowledgeCitations?: ChatKnowledgeCitation[],
  animate = true,
): Partial<Components> => ({
  table: ({ node }) => {
    return (
      <div {...getSourceAttrs(node)}>
        <MarkdownTable node={node} animate={animate} />
      </div>
    );
  },
  code: ({ children }) => {
    return (
      <code className="text-sm rounded-md bg-accent text-primary py-1 px-2 mx-0.5">
        {children}
      </code>
    );
  },
  blockquote: ({ node, children }) => {
    return (
      <div className="px-4" {...getSourceAttrs(node)}>
        <blockquote className="relative bg-accent/30 p-6 rounded-2xl my-6 overflow-hidden border">
          {renderMarkdownChildren(children, animate)}
        </blockquote>
      </div>
    );
  },
  p: ({ node, children }) => {
    return (
      <p className="leading-6 my-4 break-words" {...getSourceAttrs(node)}>
        {renderMarkdownChildren(children, animate)}
      </p>
    );
  },
  pre: ({ node, children }) => {
    return (
      <div className="px-4 py-2" {...getSourceAttrs(node)}>
        <PreBlock>{children}</PreBlock>
      </div>
    );
  },
  ol: ({ node, children, ...props }) => {
    return (
      <ol
        className="px-8 list-decimal list-outside"
        {...getSourceAttrs(node)}
        {...props}
      >
        {children}
      </ol>
    );
  },
  li: ({ node, children, ...props }) => {
    return (
      <li className="py-2 break-words" {...getSourceAttrs(node)} {...props}>
        {renderMarkdownChildren(children, animate)}
      </li>
    );
  },
  ul: ({ node, children, ...props }) => {
    return (
      <ul
        className="px-8 list-outside list-disc"
        {...getSourceAttrs(node)}
        {...props}
      >
        {children}
      </ul>
    );
  },
  strong: ({ node, children, ...props }) => {
    return (
      <span className="font-semibold" {...props}>
        {renderMarkdownChildren(children, animate)}
      </span>
    );
  },
  a: ({ node, children, ...props }) => {
    const href = (props as any).href as string | undefined;

    // Handle knowledge:// citation links (from retriever)
    if (href?.startsWith("knowledge://")) {
      return (
        <CitationLink href={href} citations={knowledgeCitations}>
          {children}
        </CitationLink>
      );
    }

    return (
      <a
        className="text-primary hover:underline inline-flex gap-1.5 items-center"
        target="_blank"
        rel="noreferrer"
        {...toAny(props)}
      >
        <LinkIcon className="size-3.5" />
        {renderMarkdownChildren(children, animate)}
      </a>
    );
  },
  h1: ({ node, children, ...props }) => {
    return (
      <h1
        className="text-3xl font-semibold mt-6 mb-2"
        {...getSourceAttrs(node)}
        {...props}
      >
        {renderMarkdownChildren(children, animate)}
      </h1>
    );
  },
  h2: ({ node, children, ...props }) => {
    return (
      <h2
        className="text-2xl font-semibold mt-6 mb-2"
        {...getSourceAttrs(node)}
        {...props}
      >
        {renderMarkdownChildren(children, animate)}
      </h2>
    );
  },
  h3: ({ node, children, ...props }) => {
    return (
      <h3
        className="text-xl font-semibold mt-6 mb-2"
        {...getSourceAttrs(node)}
        {...props}
      >
        {renderMarkdownChildren(children, animate)}
      </h3>
    );
  },
  h4: ({ node, children, ...props }) => {
    return (
      <h4
        className="text-lg font-semibold mt-6 mb-2"
        {...getSourceAttrs(node)}
        {...props}
      >
        {renderMarkdownChildren(children, animate)}
      </h4>
    );
  },
  h5: ({ node, children, ...props }) => {
    return (
      <h5
        className="text-base font-semibold mt-6 mb-2"
        {...getSourceAttrs(node)}
        {...props}
      >
        {renderMarkdownChildren(children, animate)}
      </h5>
    );
  },
  h6: ({ node, children, ...props }) => {
    return (
      <h6
        className="text-sm font-semibold mt-6 mb-2"
        {...getSourceAttrs(node)}
        {...props}
      >
        {renderMarkdownChildren(children, animate)}
      </h6>
    );
  },
  img: ({ node, children, ...props }) => {
    const { src, alt, ...rest } = props;

    return src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="mx-auto rounded-lg" src={src} alt={alt} {...rest} />
    ) : null;
  },
});

const snowflakeComponents: Partial<Components> = {
  ...buildComponents(undefined, false),
  pre: ({ children }) => (
    <div className="px-4 py-2">
      <SnowflakePreBlock>{children}</SnowflakePreBlock>
    </div>
  ),
};

const NonMemoizedMarkdown = ({
  children,
  variant,
  knowledgeCitations,
  animate = true,
  streaming = false,
}: {
  children: string;
  variant?: "snowflake";
  knowledgeCitations?: ChatKnowledgeCitation[];
  animate?: boolean;
  streaming?: boolean;
}) => {
  const deferredChildren = useDeferredValue(children);
  const markdownSource = streaming ? deferredChildren : children;
  const citationRenderPayload = streaming ? undefined : knowledgeCitations;
  const activeComponents = useMemo(
    () =>
      variant === "snowflake"
        ? {
            ...snowflakeComponents,
            ...buildComponents(citationRenderPayload, false),
          }
        : buildComponents(citationRenderPayload, animate),
    [animate, citationRenderPayload, variant],
  );
  const renderedText = useMemo(
    () =>
      typeof markdownSource === "string" && citationRenderPayload?.length
        ? linkifyKnowledgeCitationMarkers({
            text: markdownSource,
            citations: citationRenderPayload,
          })
        : markdownSource,
    [markdownSource, citationRenderPayload],
  );
  return (
    <article className="relative h-full w-full min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
      {isJson(renderedText) ? (
        <JsonView data={renderedText} />
      ) : (
        <ReactMarkdown
          components={activeComponents}
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          urlTransform={transformMarkdownUrl}
        >
          {renderedText}
        </ReactMarkdown>
      )}
    </article>
  );
};

export const Markdown = memo(
  NonMemoizedMarkdown,
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.variant === nextProps.variant &&
    prevProps.knowledgeCitations === nextProps.knowledgeCitations &&
    prevProps.animate === nextProps.animate &&
    prevProps.streaming === nextProps.streaming,
);
