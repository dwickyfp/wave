"use client";

import { isJson, isString, toAny } from "lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  LinkIcon,
} from "lucide-react";
import { Fragment, PropsWithChildren, memo, useState } from "react";
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
import { PreBlock, SnowflakePreBlock } from "./pre-block";

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

const components: Partial<Components> = {
  table: ({ node }) => {
    return <MarkdownTable node={node} />;
  },
  code: ({ children }) => {
    return (
      <code className="text-sm rounded-md bg-accent text-primary py-1 px-2 mx-0.5">
        {children}
      </code>
    );
  },
  blockquote: ({ children }) => {
    return (
      <div className="px-4">
        <blockquote className="relative bg-accent/30 p-6 rounded-2xl my-6 overflow-hidden border">
          <WordByWordFadeIn>{children}</WordByWordFadeIn>
        </blockquote>
      </div>
    );
  },
  p: ({ children }) => {
    return (
      <p className="leading-6 my-4 break-words">
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </p>
    );
  },
  pre: ({ children }) => {
    return (
      <div className="px-4 py-2">
        <PreBlock>{children}</PreBlock>
      </div>
    );
  },
  ol: ({ node, children, ...props }) => {
    return (
      <ol className="px-8 list-decimal list-outside" {...props}>
        {children}
      </ol>
    );
  },
  li: ({ node, children, ...props }) => {
    return (
      <li className="py-2 break-words" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </li>
    );
  },
  ul: ({ node, children, ...props }) => {
    return (
      <ul className="px-8 list-outside list-disc" {...props}>
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
      <h1 className="text-3xl font-semibold mt-6 mb-2" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h1>
    );
  },
  h2: ({ node, children, ...props }) => {
    return (
      <h2 className="text-2xl font-semibold mt-6 mb-2" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h2>
    );
  },
  h3: ({ node, children, ...props }) => {
    return (
      <h3 className="text-xl font-semibold mt-6 mb-2" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h3>
    );
  },
  h4: ({ node, children, ...props }) => {
    return (
      <h4 className="text-lg font-semibold mt-6 mb-2" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h4>
    );
  },
  h5: ({ node, children, ...props }) => {
    return (
      <h5 className="text-base font-semibold mt-6 mb-2" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h5>
    );
  },
  h6: ({ node, children, ...props }) => {
    return (
      <h6 className="text-sm font-semibold mt-6 mb-2" {...props}>
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
