"use client";

import Link from "next/link";
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
  return (
    <div className="space-y-2 text-xs">
      <div>
        <div className="text-lg font-semibold tabular-nums">{formatVariableValue(resolved.value, resolved.ref.digits)}</div>
        <div className="font-mono text-[11px] text-muted-foreground">{step.slug}.{resolved.ref.metric}</div>
      </div>
      <dl className="space-y-1">
        <div>
          <dt className="text-muted-foreground">Recorded by</dt>
          <dd>
            {step.name}
            {step.kitId ? <span className="text-muted-foreground"> (template {step.kitId})</span> : null}
            {step.runNumber ? (
              <>
                {", run "}
                {step.runId ? <Link href={`/explore/runs/${step.runId}${links.scopeQuery}`} className="underline underline-offset-2">{step.runNumber}</Link> : step.runNumber}
                {step.completedAt ? <span className="text-muted-foreground"> finished {new Date(step.completedAt).toLocaleString()}</span> : null}
              </>
            ) : null}
          </dd>
        </div>
        {step.inputs && step.inputs.length > 0 && (
          <div>
            <dt className="text-muted-foreground">Reads</dt>
            <dd className="flex flex-wrap gap-x-2">
              {step.inputs.map((input) => (
                <Link key={input.alias} href={`/explore/datasets/${input.datasetId}${links.scopeQuery}`} className="underline underline-offset-2">
                  {input.name}
                </Link>
              ))}
            </dd>
          </div>
        )}
        {params.length > 0 && (
          <div>
            <dt className="text-muted-foreground">With</dt>
            <dd className="font-mono text-[11px]">{params.map(([key, value]) => `${key} ${String(value)}`).join(", ")}</dd>
          </div>
        )}
      </dl>
      <Link href={canvasHref} className="inline-block underline underline-offset-2">Show the step on the canvas</Link>
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
