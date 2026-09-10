"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExploreLoading } from "./ExploreLoading";
import { ReportImage } from "./ReportImage";
import { useRouter } from "next/navigation";
import useSWR, { mutate as revalidate } from "swr";
import { Database, FileUp, ImageIcon, Loader2, Plus, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { PipelineTableSources } from "./PipelineTableSources";
import { PipelineOutputLibrary } from "./PipelineOutputLibrary";
import { TableChartDialog } from "./TableChartDialog";
import { TableFileImportDialog } from "./TableFileImportDialog";
import { appendReportBlock, type ChartTable } from "@/lib/explore/report-source-actions";
import { figureBlockId, tableBlockId, type ReportBlock } from "@/lib/explore/report-blocks";
import type { ReportOutputs, ReportTable, ReportView } from "@/lib/explore/reports";
import type { PipelineOutputSource } from "@/lib/explore/pipeline-output-types";
import { fetcher, postJson } from "@/lib/explore/client";
import { filesHref } from "@/lib/files/library-types";
import type { ExploreDatasetDetail, ExploreDatasetSummary } from "@/lib/explore/types";
import type { PipelineTableSource } from "@/lib/explore/builders/pipeline-table";
import type { TableFrame } from "./ReportWidgets";

type SourceTab = "metadata" | "pipelines" | "results" | "files";
type TableAction = "table" | "chart";
interface AddDataMenuProps {
  scope: string;
  reportId?: string;
  onBuilt?: () => void | Promise<unknown>;
  withAnalysis?: boolean;
  label?: string;
  variant?: "default" | "outline";
  className?: string;
  /** The page editor inserts into its unsaved draft, never a competing server save. */
  onInsertBlock?: (block: ReportBlock) => void | Promise<void>;
  outputs?: ReportOutputs;
  blocks?: ReportBlock[];
  disabled?: boolean;
  /** Move only the launch button when the editor panel changes layout; keep dialogs mounted. */
  triggerContainer?: HTMLElement | null;
  /** The page's inline insertion controls can open this same picker at a chosen position. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function SavedTablePreview({ table, onClose }: { table: ChartTable; onClose: () => void }) {
  const { data, error, mutate } = useSWR<TableFrame>(`/api/explore/datasets/${encodeURIComponent(table.datasetId)}/table?limit=10`, fetcher);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="max-h-[85vh] overflow-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{table.name}</DialogTitle><DialogDescription>Saved table preview · no analysis runs.</DialogDescription></DialogHeader>
    {error ? <div role="alert">Could not load the table. <Button variant="outline" onClick={() => void mutate()}>Retry</Button></div> : !data ? <ExploreLoading variant="table" label="Loading preview…" height={240} /> : <><div className="overflow-auto rounded border"><table className="w-full text-left text-xs"><thead><tr>{data.columns.slice(0, 12).map(column => <th key={column.key} className="whitespace-nowrap p-2">{column.label}{column.unit && <span className="block font-normal">{column.unit}</span>}</th>)}</tr></thead><tbody>{data.rows.slice(0, 10).map((row, index) => <tr key={index} className="border-t">{data.columns.slice(0, 12).map(column => <td key={column.key} className="max-w-64 break-words p-2">{String(row[column.key] ?? "—")}</td>)}</tr>)}</tbody></table></div><p className="text-xs text-muted-foreground">Version {data.version} · {data.total.toLocaleString()} rows. Preview shows up to 10 rows and 12 columns.</p></>}
  </DialogContent></Dialog>;
}

/** One data picker shared by the page, canvas and list; presentation never starts computation. */
export function AddDataMenu({ scope, reportId, onBuilt, withAnalysis = true, label = "Add", variant = "default", className, onInsertBlock, outputs, blocks, disabled = false, triggerContainer, open: controlledOpen, onOpenChange }: AddDataMenuProps) {
  const router = useRouter();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (next: boolean) => { setLocalOpen(next); onOpenChange?.(next); };
  const [tab, setTab] = useState<SourceTab>("metadata");
  const [building, setBuilding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [chart, setChart] = useState<ChartTable | null>(null);
  const [preview, setPreview] = useState<ChartTable | null>(null);
  const [importing, setImporting] = useState(false);
  const inFlight = useRef(false);
  const pageMode = Boolean(onInsertBlock);
  const { data: sourcesData, error: sourcesError, mutate } = useSWR<{ pipelineTables: PipelineTableSource[]; outputs?: PipelineOutputSource[] }>(`/api/explore/datasets/sources?targetKey=${encodeURIComponent(scope)}${reportId ? `&reportId=${encodeURIComponent(reportId)}` : ""}`, fetcher);
  const { data: reportData, error: reportError, mutate: retryReport } = useSWR<{ report: ReportView }>(open && reportId && !outputs ? `/api/explore/reports/${encodeURIComponent(reportId)}` : null, fetcher);
  const available = outputs ?? reportData?.report?.outputs;
  const tables = available?.tables ?? [];
  const savedBlocks = blocks ?? reportData?.report?.blocks ?? [];
  const addedTables = new Set(savedBlocks.filter(block => block.type === "table").map(block => block.datasetId));
  const addedFigures = new Set(savedBlocks.filter(block => block.type === "figure").map(block => figureBlockId(block.analysisId, block.figureName)));

  const insert = async (block: ReportBlock) => {
    if (onInsertBlock) await onInsertBlock(block);
    else if (reportId) await appendReportBlock(reportId, scope, block);
    else throw new Error("Open this action from a report first.");
    if (!onInsertBlock) await revalidate(`/api/explore/reports/${encodeURIComponent(reportId!)}`);
    await onBuilt?.();
  };

  const runAction = async (action: () => Promise<void>) => {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBuilding(true);
    setProblem(null);
    try { await action(); }
    catch (error) {
      const message = error instanceof Error ? error.message : "Could not add the data.";
      setProblem(message);
      toast.error(message);
    } finally { inFlight.current = false; setBuilding(false); }
  };

  const selectSavedTable = async (id: string, name: string, action: TableAction) => {
    if (action === "chart") {
      const { dataset } = await fetcher(`/api/explore/datasets/${encodeURIComponent(id)}`) as { dataset: ExploreDatasetDetail };
      if (dataset.targetKey !== scope) throw new Error("This table belongs to a different data scope.");
      await onBuilt?.();
      setChart({ datasetId: id, name: dataset.name, rowCount: dataset.currentVersion?.rowCount ?? 0, version: dataset.currentVersion?.number ?? null, columns: dataset.schema.columns });
    } else if (pageMode) {
      await insert({ id: tableBlockId(id), type: "table", datasetId: id, caption: name, span: 2, search: true, sortable: true, download: true });
      toast.success(`${name} added to the page`);
    } else {
      await onBuilt?.();
      toast.success(`${name} is available on the canvas`);
    }
    setOpen(false);
  };

  const build = async (kind: "samples" | "sequencing" | "pipeline-table", options?: Record<string, unknown>, action: TableAction = "table", template?: { id: string; inputAlias: string }) => {
    const result = await postJson<{ dataset: ExploreDatasetSummary; version: { number: number; rowCount: number; unchanged: boolean }; warnings: string[] }>("/api/explore/datasets/build", { targetKey: scope, kind, options });
    for (const warning of result.warnings) toast.warning(warning);
    await onBuilt?.();
    await mutate();
    if (template) {
      const query = new URLSearchParams({ scope, kit: template.id, dataset: result.dataset.id, input: template.inputAlias });
      if (reportId) query.set("report", reportId);
      router.push(`/explore/analyses/new?${query}`);
      setOpen(false);
    } else await selectSavedTable(result.dataset.id, result.dataset.name, action);
  };

  const pipelineTable = (source: PipelineOutputSource, runId: string, action: TableAction) => void runAction(async () => {
    const usage = source.runs.find(run => run.id === runId)?.usage;
    if (usage) await selectSavedTable(usage.datasetId, source.label, action);
    else await build("pipeline-table", { pipelineId: source.pipelineId, outputId: source.outputId, runIds: [runId] }, action);
  });

  const tableCard = (table: ReportTable, title = table.name, description?: string) => <article key={table.datasetId} className="min-w-0 space-y-3 rounded-xl border bg-background p-4"><div className="flex gap-2"><Table2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" /><div className="min-w-0"><h3 className="break-words text-sm font-semibold" title={table.name}>{title}</h3>{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}<p className="mt-1 text-xs text-muted-foreground">{table.rowCount.toLocaleString()} {table.rowCount === 1 ? "row" : "rows"} · {table.columnCount} columns · version {table.version ?? "—"}{table.latestWrite ? ` · ${table.latestWrite.runNumber}` : ""}</p></div></div>
    <div className="flex flex-wrap gap-2"><Button size="sm" disabled={building || (pageMode && addedTables.has(table.datasetId))} onClick={() => void runAction(() => selectSavedTable(table.datasetId, title, "table"))}>{pageMode ? addedTables.has(table.datasetId) ? "Table on page" : "Add table to page" : "Use table"}</Button>{reportId && <Button size="sm" variant="outline" disabled={building} onClick={() => void runAction(() => selectSavedTable(table.datasetId, title, "chart"))}>Create chart</Button>}<Button size="sm" variant="ghost" disabled={building} onClick={() => setPreview(table)}>Preview</Button></div>
  </article>;

  const trigger = <DialogTrigger asChild><Button size="sm" variant={variant} disabled={disabled || building} className={className} onClick={() => { setProblem(null); void mutate(); }}>
      {building ? <Loader2 aria-hidden className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus aria-hidden className="mr-1.5 h-3.5 w-3.5" />}{label}
    </Button></DialogTrigger>;
  return <>
    <Dialog open={open} onOpenChange={next => { if (!building) setOpen(next); }}>
    {triggerContainer === undefined ? trigger : triggerContainer && createPortal(trigger, triggerContainer)}
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl"><DialogHeader className="pr-5"><DialogTitle>{pageMode ? "Add to page" : "Add data"}</DialogTitle><DialogDescription>{pageMode ? "Choose saved data to add a table, create a chart or reuse a finished figure." : "Bring saved data onto the canvas, or create a chart for the report page."} No pipeline or analysis runs when you add data.</DialogDescription></DialogHeader>
      <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Data sources">{([
        ["metadata", "Metadata"], ["pipelines", "Pipeline outputs"], ["results", "Saved analysis results"], ["files", "Your files"],
      ] as const).map(([id, title]) => <Button key={id} size="sm" variant={tab === id ? "secondary" : "ghost"} aria-pressed={tab === id} disabled={building} onClick={() => setTab(id)}>{title}</Button>)}</div>
      {problem && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{problem}</p>}
      {building && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden className="h-4 w-4 animate-spin" />Preparing saved data… This does not start a pipeline.</p>}
      {tab === "metadata" && reportId && !available && !reportError && <ExploreLoading variant="cards" label="Loading saved metadata…" />}
      {tab === "metadata" && reportError && !available && <div role="alert" className="space-y-3 text-sm"><p>Could not load saved metadata.</p><Button size="sm" variant="outline" onClick={() => void retryReport()}>Retry loading metadata</Button></div>}
      {tab === "metadata" && (!reportId || available) && <section aria-label="Sample and sequencing metadata" className="grid gap-3 sm:grid-cols-2">{([
        ["samples", "Samples", "Sample metadata, including study groups when available."], ["sequencing", "Sequencing", "Sequencing information, read counts and saved quality measurements."],
      ] as const).map(([kind, title, description]) => {
        const existing = tables.find(table => table.kind === kind);
        return existing ? tableCard(existing, title, description) : <article key={kind} className="space-y-3 rounded-xl border p-4"><Database className="h-5 w-5 text-teal-700" /><h3 className="text-sm font-semibold">{title}</h3><p className="text-sm text-muted-foreground">{description}</p><div className="flex flex-wrap gap-2"><Button size="sm" disabled={building} onClick={() => void runAction(() => build(kind))}>{pageMode ? "Add table to page" : "Add table"}</Button>{reportId && <Button size="sm" variant="outline" disabled={building} onClick={() => void runAction(() => build(kind, undefined, "chart"))}>Create chart</Button>}</div></article>;
      })}</section>}
      {tab === "pipelines" && (sourcesError ? <div role="alert" className="space-y-2 rounded-lg border p-4 text-sm"><p>Could not load pipeline outputs. {sourcesError instanceof Error ? sourcesError.message : "Please try again."}</p><Button size="sm" variant="outline" onClick={() => void mutate()}>Retry loading outputs</Button></div> : !sourcesData ? <ExploreLoading variant="cards" label="Loading pipeline outputs…" /> : sourcesData.outputs ? <PipelineOutputLibrary scope={scope} forReport={pageMode} addedTableIds={addedTables} sources={withAnalysis ? sourcesData.outputs : sourcesData.outputs.map(source => ({ ...source, templates: [] }))} busy={building}
        onAdd={(source, runId) => pipelineTable(source, runId, "table")}
        onChart={reportId ? (source, runId) => pipelineTable(source, runId, "chart") : undefined}
        onTemplate={(source, runId, template) => void runAction(() => build("pipeline-table", { pipelineId: source.pipelineId, outputId: source.outputId, runIds: [runId] }, "table", template))}
      /> : <PipelineTableSources scope={scope} sources={sourcesData.pipelineTables ?? []} busy={building} onAdd={(source, runId) => void runAction(() => build("pipeline-table", { pipelineId: source.pipelineId, outputId: source.outputId, ...(runId ? { runIds: [runId] } : {}) }))} />)}
      {tab === "results" && <section aria-label="Saved analysis results" className="space-y-3"><p className="text-xs text-muted-foreground">Finished figures and derived tables from this report’s analyses. Adding them does not run the analysis again.</p>
        {!available ? reportError ? <div role="alert" className="space-y-3 text-sm"><p>Could not load saved results.</p><Button size="sm" variant="outline" onClick={() => void retryReport()}>Retry loading saved results</Button></div> : reportId ? <ExploreLoading variant="cards" label="Loading saved results…" /> : <p>Open a report to reuse its saved figures.</p> : !available.figures.length && !tables.some(table => table.output) ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No saved analysis results in this report yet. Metadata and pipeline tables can still be added directly.</p> : <div className="grid gap-3 sm:grid-cols-2">{available.figures.map(figure => {
          const id = figureBlockId(figure.analysisId, figure.figureName);
          const added = addedFigures.has(id);
          return <article key={id} className="space-y-3 rounded-xl border p-4">{figure.thumbnailUrl ? <ReportImage src={figure.thumbnailUrl} alt={figure.figureName} height={96} /> : <ImageIcon className="h-6 w-6 text-teal-700" />}<h3 className="text-sm font-semibold">{figure.figureName.replace(/_/g, " ")}</h3><p className="text-xs text-muted-foreground">{figure.analysisName} · {figure.runNumber}</p><Button size="sm" disabled={building || added || !reportId} onClick={() => void runAction(async () => { await insert({ id, type: "figure", analysisId: figure.analysisId, figureName: figure.figureName, caption: `${figure.figureName} · ${figure.analysisName}`, span: 2 }); toast.success("Figure added to the page"); setOpen(false); })}>{added ? "Figure on page" : "Add figure to page"}</Button></article>;
        })}{tables.filter(table => table.output).map(table => tableCard(table))}</div>}
      </section>}
      {tab === "files" && <section aria-label="Your files" className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><h3 className="text-sm font-semibold">Files library</h3><p className="mt-1 text-sm text-muted-foreground">Reuse an upload or add source data and reference files for this report.</p></div><Button size="sm" onClick={() => { setOpen(false); router.push(filesHref(scope, reportId)); }}>Add from Files</Button></div><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><h3 className="flex items-center gap-2 text-sm font-semibold"><FileUp className="h-4 w-4 text-teal-700" />Import a table</h3><p className="mt-1 text-sm text-muted-foreground">Upload CSV, TSV or Excel. Preview and map its columns before importing. The original is saved in Files for reuse.</p></div><Button size="sm" variant="outline" onClick={() => setImporting(true)}>Choose a file</Button></div>{reportId && !available && (reportError ? <div role="alert" className="space-y-3 text-sm"><p>Could not load saved files.</p><Button size="sm" variant="outline" onClick={() => void retryReport()}>Retry loading saved files</Button></div> : <ExploreLoading variant="cards" label="Loading saved files…" />)}<div className="grid gap-3 sm:grid-cols-2">{tables.filter(table => table.kind === "external").map(table => tableCard(table))}</div></section>}
    </DialogContent></Dialog>
    {chart && <TableChartDialog tables={[chart]} initialDatasetId={chart.datasetId} onClose={() => setChart(null)} onAdd={async block => { await insert(block); toast.success("Chart added to the page"); }} />}
    {preview && <SavedTablePreview table={preview} onClose={() => setPreview(null)} />}
    {importing && <TableFileImportDialog scope={scope} onClose={() => setImporting(false)} onImported={async dataset => { await onBuilt?.(); if (reportId && !outputs) await revalidate(`/api/explore/reports/${encodeURIComponent(reportId)}`); toast.success(`${dataset.name} is available under Your files`); }} />}
  </>;
}
