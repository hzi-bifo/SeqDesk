"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** Markdown (GitHub flavour: tables, task lists, strikethrough) rendered with the app's type styles; used by report text blocks. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("min-w-0 max-w-full text-sm leading-6", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mb-3 text-xl font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-4 text-lg font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1 mt-3 font-semibold">{children}</h3>,
          p: ({ children }) => <p className="mb-3 break-words last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-3 list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal pl-5">{children}</ol>,
          a: ({ children, href }) => (
            <a href={href} className="underline underline-offset-2" target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          blockquote: ({ children }) => <blockquote className="mb-3 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>,
          code: ({ children }) => <code className="break-all rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>,
          table: ({ children }) => (
            <div className="my-3 max-w-full overflow-auto rounded-md border">
              <table className="min-w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b bg-muted px-3 py-2 text-left font-medium">{children}</th>,
          td: ({ children }) => <td className="border-b px-3 py-2">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
