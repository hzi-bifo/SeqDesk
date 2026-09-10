"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Loader2, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TABLE_KIND_DEFINITIONS } from "@/lib/explore/dataset-kinds";
import type { PipelineTableSource } from "@/lib/explore/builders/pipeline-table";

interface Props {
  scope: string;
  sources: PipelineTableSource[];
  busy: boolean;
  onAdd: (source: PipelineTableSource, runId?: string) => void;
}

function pipelineHref(scope: string, pipelineId: string) {
  const separator = scope.indexOf(":");
  const kind = scope.slice(0, separator);
  const id = scope.slice(separator + 1);
  if (!id || (kind !== "order" && kind !== "study")) return null;
  return `/${kind === "order" ? "orders" : "studies"}/${encodeURIComponent(id)}/pipelines?pipeline=${encodeURIComponent(pipelineId)}`;
}

function SourceCard({ source, busy, onAdd }: Pick<Props, "busy" | "onAdd"> & { source: PipelineTableSource }) {
  const [chosenRun, setChosenRun] = useState("");
  // A refreshed catalog must not submit a run that is no longer eligible.
  const runId = source.runs.some(run => run.id === chosenRun) ? chosenRun : "";
  const onlyRun = source.runs.length === 1 ? source.runs[0] : null;
  return (
    <div className="space-y-3 rounded-lg border bg-background p-4">
      <div>
        <h5 className="text-sm font-semibold">{source.label}</h5>
        <p className="mt-1 text-xs text-muted-foreground">
          {source.format?.toUpperCase() ?? "Delimited"} table · {TABLE_KIND_DEFINITIONS[source.tableKind]?.label ?? source.tableKind}
        </p>
        {source.description && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{source.description}</p>}
      </div>
      {source.columnLabels && <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Included values</summary>
        <p className="mt-2 leading-relaxed">{Object.values(source.columnLabels).join(" · ")}</p>
      </details>}
      {onlyRun ? (
        <p className="text-xs text-muted-foreground">From run <span className="break-all font-medium text-foreground">{onlyRun.runNumber}</span></p>
      ) : source.runs.length > 1 ? (
        <label className="block text-xs font-medium">
          Result source
          <select className="mt-1 block w-full min-w-0 rounded-md border bg-background p-2 text-sm font-normal" value={runId} disabled={busy} onChange={event => setChosenRun(event.target.value)}>
            <option value="">{source.runs.some(run => run.selected) ? "Selected run, then latest for other samples" : "Latest completed results per sample"}</option>
            {source.runs.map(run => <option key={run.id} value={run.id}>{run.runNumber}{run.selected ? " · selected" : ""}</option>)}
          </select>
          <span className="mt-1 block font-normal text-muted-foreground">{runId ? "Pinned to this completed run." : "Builds one result per sample from the eligible completed runs."}</span>
        </label>
      ) : <p className="text-xs text-muted-foreground">No completed run is available.</p>}
      <Button size="sm" variant="outline" disabled={busy || !source.runs.length} onClick={() => onAdd(source, runId || undefined)} aria-label={`Add ${source.label}`}>
        {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Add table
      </Button>
    </div>
  );
}

/** Manifest-declared tables, grouped by the pipeline that actually produced them. */
export function PipelineTableSources({ scope, sources, busy, onAdd }: Props) {
  const pipelines = new Map<string, PipelineTableSource[]>();
  for (const source of sources) pipelines.set(source.pipelineId, [...(pipelines.get(source.pipelineId) ?? []), source]);
  if (!pipelines.size) return <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No report-ready pipeline tables yet. Complete a pipeline that provides a summary table. HTML reports and logs remain on the pipeline page.</p>;
  return <div className="space-y-4">
    {[...pipelines].map(([pipelineId, tables]) => {
      const href = pipelineHref(scope, pipelineId);
      return <section key={pipelineId} aria-label={tables[0].pipelineName} className="min-w-0 rounded-xl border bg-muted/20 p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold"><Workflow className="h-4 w-4 text-muted-foreground" />{tables[0].pipelineName}</h4>
          {href && <Link href={href} className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4">Reports & run history<ArrowUpRight className="h-3 w-3" /></Link>}
        </div>
        <div className={tables.length > 1 ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"}>
          {tables.map(source => <SourceCard key={`${scope}:${pipelineId}:${source.outputId}`} source={source} busy={busy} onAdd={onAdd} />)}
        </div>
      </section>;
    })}
    <p className="text-xs text-muted-foreground">Tables supply values for charts and analyses. Original HTML reports and technical details stay on the pipeline page.</p>
  </div>;
}
