import type { PropsWithChildren } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function PilotMarkdown(props: PropsWithChildren) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
        code: ({ children, className }) => (
          <code className={className}>{children}</code>
        ),
        pre: ({ children }) => <pre>{children}</pre>,
      }}
    >
      {String(props.children ?? "")}
    </ReactMarkdown>
  );
}
