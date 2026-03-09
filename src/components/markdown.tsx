"use client";

import { isJson, isString, toAny } from "lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  LinkIcon,
  FileTextIcon,
} from "lucide-react";
import {
  Fragment,
  PropsWithChildren,
  memo,
  useState,
  useCallback,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
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

const TABLE_PAGE_SIZE = 10;

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

const MarkdownTable = memo(({ node }: { node?: any }) => {
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
        <Table>
          <TableHeader>
            <TableRow>
              {headerCells.map((th: any, i: number) => (
                <TableHead key={i}>
                  <WordByWordFadeIn>
                    {th.children?.map((c: any, j: number) => (
                      <Fragment key={j}>{renderHastNode(c)}</Fragment>
                    ))}
                  </WordByWordFadeIn>
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
                    <TableCell key={cellIdx}>
                      <WordByWordFadeIn>
                        {td.children?.map((c: any, j: number) => (
                          <Fragment key={j}>{renderHastNode(c)}</Fragment>
                        ))}
                      </WordByWordFadeIn>
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
});
MarkdownTable.displayName = "MarkdownTable";

// ── Citation Link ──────────────────────────────────────────────────────────────
// Renders knowledge:// links (from retriever citations) as interactive badges
// that open the document preview panel in chat.
function CitationLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      // href format: knowledge://groupId/docId
      const path = href.replace("knowledge://", "");
      const [groupId, docId] = path.split("/");
      if (!groupId || !docId) return;

      // Extract plain text name from children
      const extractText = (node: React.ReactNode): string => {
        if (typeof node === "string") return node;
        if (Array.isArray(node)) return node.map(extractText).join("");
        if (node && typeof node === "object" && "props" in (node as any)) {
          return extractText((node as any).props?.children);
        }
        return "";
      };
      const documentName = extractText(children) || "Document";

      appStore.setState({
        citationDocumentPreview: { documentId: docId, groupId, documentName },
      });
    },
    [href, children],
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleClick}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer border border-primary/20"
        >
          <FileTextIcon className="size-3 shrink-0" />
          <span>{children}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        Click to preview document
      </TooltipContent>
    </Tooltip>
  );
}

const components: Partial<Components> = {
  table: ({ node }) => {
    return (
      <div {...getSourceAttrs(node)}>
        <MarkdownTable node={node} />
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
          <WordByWordFadeIn>{children}</WordByWordFadeIn>
        </blockquote>
      </div>
    );
  },
  p: ({ node, children }) => {
    return (
      <p className="leading-6 my-4 break-words" {...getSourceAttrs(node)}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
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
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
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
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </span>
    );
  },
  a: ({ node, children, ...props }) => {
    const href = (props as any).href as string | undefined;

    // Handle knowledge:// citation links (from retriever)
    if (href?.startsWith("knowledge://")) {
      return <CitationLink href={href}>{children}</CitationLink>;
    }

    return (
      <a
        className="text-primary hover:underline flex gap-1.5 items-center"
        target="_blank"
        rel="noreferrer"
        {...toAny(props)}
      >
        <LinkIcon className="size-3.5" />
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
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
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
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
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
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
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
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
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
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
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
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
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
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
};

const snowflakeComponents: Partial<Components> = {
  ...components,
  pre: ({ children }) => (
    <div className="px-4 py-2">
      <SnowflakePreBlock>{children}</SnowflakePreBlock>
    </div>
  ),
};

const NonMemoizedMarkdown = ({
  children,
  variant,
}: {
  children: string;
  variant?: "snowflake";
}) => {
  const activeComponents =
    variant === "snowflake" ? snowflakeComponents : components;
  return (
    <article className="w-full h-full relative">
      {isJson(children) ? (
        <JsonView data={children} />
      ) : (
        <ReactMarkdown
          components={activeComponents}
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
        >
          {children}
        </ReactMarkdown>
      )}
    </article>
  );
};

export const Markdown = memo(
  NonMemoizedMarkdown,
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.variant === nextProps.variant,
);
