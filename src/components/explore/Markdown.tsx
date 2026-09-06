"use client";

import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatVariableValue, resolveVariable, type ReportVariables, type ResolvedVariable } from "@/lib/explore/variables";

/** Where a cited value can be followed to: the report's canvas and the scope's pages. */
export interface VariableLinks {
  reportId: string;
  scopeQuery: string;
}

/** The card behind a cited value: the step, its run, what it read and the settings it used. */
function VariableCard({ resolved, links }: { resolved: ResolvedVariable; links: VariableLinks }) {
  const step = resolved.step;
  if (!step) return <p className="text-xs text-muted-foreground">No step of this report is called {resolved.ref.step}.</p>;
  if (!resolved.found) return <p className="text-xs text-muted-foreground">{step.name} recorded no value called {resolved.ref.metric}.</p>;
  const params = Object.entries(step.params ?? {}).filter(([, value]) => value !== null && value !== undefined && value !== "" && typeof value !== "object");
  const canvasHref = `/explore/reports/${encodeURIComponent(links.reportId)}${links.scopeQuery}&mode=edit&view=canvas&focus=${encodeURIComponent(`analysis:${step.analysisId}`)}`;
  const finished = step.completedAt ? new Date(step.completedAt).toLocaleString() : null;
  return (
    <div className="text-xs">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-xl font-semibold tabular-nums">{formatVariableValue(resolved.value, resolved.ref.digits)}</span>
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-muted-foreground">
          {step.slug}.{resolved.ref.metric}
        </code>
      </div>
      <dl className="mt-3 grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt className="text-muted-foreground">Step</dt>
        <dd className="min-w-0">
          {step.name}
          {step.kitId ? <span className="text-muted-foreground"> · template {step.kitId}</span> : null}
        </dd>
        {step.runNumber && (
          <>
            <dt className="text-muted-foreground">Run</dt>
            <dd className="min-w-0">
              {step.runId ? <Link href={`/explore/runs/${step.runId}${links.scopeQuery}`} className="font-medium underline underline-offset-2">{step.runNumber}</Link> : step.runNumber}
              {finished ? <span className="text-muted-foreground"> · finished {finished}</span> : null}
            </dd>
          </>
        )}
        {step.inputs && step.inputs.length > 0 && (
          <>
            <dt className="text-muted-foreground">Reads</dt>
            <dd className="min-w-0">
              {step.inputs.map((input, index) => (
                <span key={input.alias}>
                  {index > 0 ? ", " : ""}
                  <Link href={`/explore/datasets/${input.datasetId}${links.scopeQuery}`} className="underline underline-offset-2">
                    {input.name}
                  </Link>
                </span>
              ))}
            </dd>
          </>
        )}
        {params.length > 0 && (
          <>
            <dt className="text-muted-foreground">Settings</dt>
            <dd className="min-w-0">
              <span className="flex flex-wrap gap-1">
                {params.map(([key, value]) => (
                  <span key={key} className="rounded border px-1.5 font-mono text-[10px]">
                    {key} <span className="text-muted-foreground">{String(value)}</span>
                  </span>
                ))}
              </span>
            </dd>
          </>
        )}
      </dl>
      <div className="mt-3 border-t pt-2">
        <Link href={canvasHref} className="inline-flex items-center gap-1 font-medium hover:underline">
          <LayoutGrid className="h-3.5 w-3.5" />
          Show the step on the canvas
        </Link>
      </div>
    </div>
  );
}

/** Markdown (GitHub flavour: tables, task lists, strikethrough) rendered with the app's type styles; used by report text blocks. */
export function Markdown({ children, className, variables, variableLinks }: { children: string; className?: string; variables?: ReportVariables; variableLinks?: VariableLinks }) {
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
          code: ({ children }) => {
            // `r step.metric` cites a number a step recorded; it shows the current value.
            const text = Array.isArray(children) ? children.join("") : String(children ?? "");
            const resolved = variables ? resolveVariable(text, variables) : null;
            if (resolved) {
              const title = resolved.found && resolved.step ? `${resolved.ref.step}.${resolved.ref.metric} from ${resolved.step.name}${resolved.step.runNumber ? `, ${resolved.step.runNumber}` : ""}; click for where it comes from` : `No step defines ${resolved.ref.step}.${resolved.ref.metric}`;
              const chip = cn("rounded-sm border-b border-dotted px-0.5", resolved.found ? "border-foreground/50 font-medium" : "border-destructive bg-destructive/10 text-destructive");
              if (!variableLinks) return <span className={chip} title={title}>{resolved.text}</span>;
              return (
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className={cn(chip, "cursor-pointer hover:bg-secondary")} title={title}>
                      {resolved.text}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80">
                    <VariableCard resolved={resolved} links={variableLinks} />
                  </PopoverContent>
                </Popover>
              );
            }
            return <code className="break-all rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>;
          },
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
