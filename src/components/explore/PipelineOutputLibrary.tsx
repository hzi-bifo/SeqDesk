"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowUpRight, Download, File, FileText, ImageIcon, Search, Table2, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExploreLoading } from "./ExploreLoading";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { fetcher } from "@/lib/explore/client";
import { pipelineOutputFileUrl, type OutputViewKind, type PipelineOutputFile, type PipelineOutputSource } from "@/lib/explore/pipeline-output-types";
import type { ExploreRowData } from "@/lib/explore/types";

const icons = { table: Table2, report: FileText, image: ImageIcon, file: File };
const labels = { table: "Table", report: "Report", image: "Image", file: "File" };
const formatSize = (bytes: number | null) => bytes == null ? null : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${Math.ceil(bytes / 1024)} KiB`;

function TablePreview({ scope, file }: { scope: string; file: PipelineOutputFile }) {
  const { data, error, mutate } = useSWR<{ columns: Array<{ key: string; label: string; unit?: string }>; rows: ExploreRowData[]; truncated: boolean }>(pipelineOutputFileUrl(scope, file.id, "table"), fetcher, { shouldRetryOnError: false });
  if (error) return <div role="alert" className="space-y-3 text-sm"><p>{error instanceof Error ? error.message : "Could not preview this table."}</p><Button variant="outline" onClick={() => void mutate()}>Retry preview</Button></div>;
  if (!data) return <ExploreLoading variant="table" label="Loading table preview…" height={240} />;
  return <><div className="max-h-[55vh] overflow-auto rounded-lg border"><table className="w-full text-left text-xs"><thead className="bg-muted"><tr>{data.columns.map(column => <th key={column.key} className="whitespace-nowrap p-3">{column.label}{column.unit && <span className="block font-normal text-muted-foreground">{column.unit}</span>}</th>)}</tr></thead><tbody>{data.rows.map((row, i) => <tr key={i} className="border-t">{data.columns.map(column => <td key={column.key} className="max-w-64 break-words p-3">{String(row[column.key] ?? "—")}</td>)}</tr>)}</tbody></table></div><p className="text-xs text-muted-foreground">{data.truncated ? "Preview limited to 10 rows and 30 columns. Add the table to work with all rows." : `${data.rows.length} preview row${data.rows.length === 1 ? "" : "s"}.`} Previewing does not change your report.</p></>;
}

function OutputCard({ source, scope, busy, forReport, addedTableIds, onAdd, onChart, onTemplate, onPreview }: {
  source: PipelineOutputSource; scope: string; busy: boolean;
  forReport?: boolean;
  addedTableIds?: ReadonlySet<string>;
  onAdd: (source: PipelineOutputSource, runId: string) => void;
  onChart?: (source: PipelineOutputSource, runId: string) => void;
  onTemplate: (source: PipelineOutputSource, runId: string, template: PipelineOutputSource["templates"][number]) => void;
  onPreview: (file: PipelineOutputFile) => void;
}) {
  const [chosen, setChosen] = useState("");
  const [showFiles, setShowFiles] = useState(false);
  const selectedRun = source.table?.runs.find(run => run.selected)?.id;
  const run = source.runs.find(run => run.id === chosen) ?? source.runs.find(run => run.id === selectedRun) ?? source.runs[0];
  const Icon = icons[source.kind];
  if (!run) return null;
  const tableAdded = Boolean(run.usage && addedTableIds?.has(run.usage.datasetId));
  return <article className="h-full min-w-0 rounded-xl border bg-background p-4">
    <div className="flex items-start gap-3">
      <div className="rounded-lg bg-teal-50 p-2.5 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"><Icon className="h-5 w-5" /></div>
      <div className="min-w-0 flex-1"><h5 className="text-sm font-semibold">{source.label}</h5>
        <p className="mt-1 text-xs text-muted-foreground">{labels[source.kind]}{source.table?.format ? ` · ${source.table.format.toUpperCase()}` : ""} · {run.files.length} file{run.files.length === 1 ? "" : "s"}{source.table?.table?.rowEntity ? ` · One row per ${source.table.table.rowEntity}` : ""}</p>
        {source.description && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{source.description}</p>}
        {source.table && <p className={`mt-2 text-xs ${run.usage ? "text-teal-700 dark:text-teal-300" : "text-muted-foreground"}`}>{run.usage?.state === "report" ? "On report" : run.usage ? "In workspace · not on this report page" : "Available to add"}</p>}
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {source.table && (forReport ? <Button size="sm" disabled={busy || tableAdded} onClick={() => onAdd(source, run.id)}>{tableAdded ? "Table on page" : "Add table to page"}</Button> : run.usage ? <Link className="px-2 text-xs underline" href={`/explore/datasets/${encodeURIComponent(run.usage.datasetId)}?scope=${encodeURIComponent(scope)}`}>Open table</Link> : <Button size="sm" disabled={busy} title="Make this table available on the canvas. It is not placed on the report page yet." onClick={() => onAdd(source, run.id)}>Add table</Button>)}
      {source.table && onChart && <Button size="sm" variant="outline" disabled={busy} onClick={() => onChart(source, run.id)}>Create chart</Button>}
      {run.files.length === 1 ? <>
        {run.files[0].previewable && <Button size="sm" variant="outline" onClick={() => onPreview(run.files[0])}>Preview</Button>}
        <a className="inline-flex items-center gap-1 px-2 text-xs text-muted-foreground underline" href={pipelineOutputFileUrl(scope, run.files[0].id, "download")}><Download className="h-3.5 w-3.5" />Download</a>
      </> : <Button size="sm" variant="outline" aria-expanded={showFiles} onClick={() => setShowFiles(!showFiles)}>{showFiles ? "Hide files" : "Browse files"}</Button>}
    </div>
    {showFiles && <ul className="mt-3 max-h-52 space-y-2 overflow-y-auto border-t pt-3">{run.files.map(file => <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <div className="min-w-0"><p className="break-all font-medium">{file.name}</p><p className="text-muted-foreground">{[file.sample, formatSize(file.size)].filter(Boolean).join(" · ")}</p></div>
      <div className="flex items-center gap-3">{file.previewable && <button type="button" className="underline" onClick={() => onPreview(file)}>Preview</button>}<a className="underline" href={pipelineOutputFileUrl(scope, file.id, "download")}>Download</a></div>
    </li>)}</ul>}
    {source.table && source.templates.length > 0 && <details className="mt-3 text-xs">
      <summary className="cursor-pointer font-medium text-muted-foreground">Use in an analysis · {source.templates.length} matching template{source.templates.length === 1 ? "" : "s"}</summary>
      <p className="mb-2 mt-2 text-muted-foreground">For additional calculations. Opens analysis setup; nothing runs until you explicitly start it.</p>
      <div className="space-y-2">{source.templates.map(template => <button key={`${template.id}:${template.inputAlias}`} type="button" className="flex w-full items-center justify-between gap-2 rounded-lg border bg-background p-3 text-left hover:border-teal-500 disabled:opacity-50" disabled={busy} onClick={() => onTemplate(source, run.id, template)}><span><span className="font-medium">{template.name}</span>{template.outputSummary && <span className="mt-1 block text-muted-foreground">{template.outputSummary}</span>}</span><ArrowUpRight aria-hidden className="h-3 w-3 shrink-0" /></button>)}</div>
    </details>}
    <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">Source & details</summary>
      {source.runs.length > 1 ? <label className="mt-2 block">Result source<select className="mt-1 block w-full rounded border bg-background p-2" value={run.id} disabled={busy} onChange={event => setChosen(event.target.value)}>{source.runs.map(run => <option key={run.id} value={run.id}>{run.runNumber}</option>)}</select></label> : <p className="mt-2 break-all">From run {run.runNumber}</p>}
      {run.completedAt && <p className="mt-1">Completed {new Date(run.completedAt).toLocaleString()}</p>}
      {source.table && <p className="mt-1">Adding this table keeps it tied to this run. A newer run does not replace it automatically.</p>}
      {source.description && <p className="mt-2">{source.description}</p>}
      {source.table?.table?.columns && <ul className="mt-2 space-y-1">{Object.entries(source.table.table.columns).map(([key, column]) => <li key={key}>{column.label ?? source.table?.columnLabels?.[key] ?? key} · {column.type}{column.unit ? ` · ${column.unit}` : ""}</li>)}</ul>}
      {source.table?.table?.schemaId && <p className="mt-2 break-all">Schema {source.table.table.schemaId} · {source.table.table.schemaVersion ?? "unversioned"}</p>}
    </details>
  </article>;
}

export function PipelineOutputLibrary({ scope, sources, busy, forReport, addedTableIds, onAdd, onChart, onTemplate }: {
  scope: string; sources: PipelineOutputSource[]; busy: boolean;
  forReport?: boolean;
  addedTableIds?: ReadonlySet<string>;
  onAdd: (source: PipelineOutputSource, runId: string) => void;
  onChart?: (source: PipelineOutputSource, runId: string) => void;
  onTemplate: (source: PipelineOutputSource, runId: string, template: PipelineOutputSource["templates"][number]) => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<OutputViewKind | "all">("all");
  const [preview, setPreview] = useState<PipelineOutputFile | null>(null);
  const matching = sources.filter(source => (kind === "all" || source.kind === kind) && `${source.pipelineName} ${source.label} ${source.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const grouped = new Map<string, PipelineOutputSource[]>();
  for (const source of matching) grouped.set(source.pipelineId, [...(grouped.get(source.pipelineId) ?? []), source]);
  const separator = scope.indexOf(":");
  const scopeType = scope.slice(0, separator);
  const scopeId = scope.slice(separator + 1);
  return <div className="space-y-4">
    <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search pipeline outputs" placeholder="Search results or pipelines…" value={query} onChange={event => setQuery(event.target.value)} className="pl-9" /></div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter output types">{(["all", "table", "report", "image", "file"] as const).map(value => <Button key={value} size="sm" variant={kind === value ? "secondary" : "ghost"} aria-pressed={kind === value} onClick={() => setKind(value)}>{value === "all" ? "All results" : `${labels[value]}s`}</Button>)}</div>
    {!sources.length ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No saved pipeline outputs yet. Results appear here after a pipeline completes.</p> : !matching.length ? <p role="status" className="text-sm text-muted-foreground">No outputs match this search or filter.</p> : [...grouped].map(([pipelineId, outputs]) => <section key={pipelineId} aria-label={outputs[0].pipelineName}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h4 className="flex items-center gap-2 text-sm font-semibold"><Workflow className="h-4 w-4 text-muted-foreground" />{outputs[0].pipelineName}</h4>{["order", "study"].includes(scopeType) && <Link href={`/${scopeType === "order" ? "orders" : "studies"}/${encodeURIComponent(scopeId)}/pipelines?pipeline=${encodeURIComponent(pipelineId)}`} className="text-xs text-muted-foreground underline">Run history ↗</Link>}</div>
      <div className="grid items-stretch gap-3 sm:grid-cols-2">{outputs.map(source => <OutputCard key={source.id} source={source} scope={scope} busy={busy} forReport={forReport} addedTableIds={addedTableIds} onAdd={onAdd} onChart={onChart} onTemplate={onTemplate} onPreview={setPreview} />)}</div>
    </section>)}
    {preview && <Dialog open onOpenChange={open => { if (!open) setPreview(null); }}><DialogContent className="max-h-[90vh] overflow-auto sm:max-w-5xl"><DialogHeader><DialogTitle className="break-all pr-6">{preview.name}</DialogTitle><DialogDescription>Saved pipeline output{preview.sample ? ` · ${preview.sample}` : ""}</DialogDescription></DialogHeader>
      <a href={pipelineOutputFileUrl(scope, preview.id, "download")} className="text-sm underline">Download original file</a>
      {preview.kind === "table" ? <TablePreview scope={scope} file={preview} /> : <iframe title={preview.name} src={pipelineOutputFileUrl(scope, preview.id)} sandbox="allow-scripts" className="h-[65vh] w-full rounded-lg border" />}
    </DialogContent></Dialog>}
  </div>;
}
