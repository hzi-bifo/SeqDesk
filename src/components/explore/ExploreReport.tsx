"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  Pencil,
  Plus,
  RectangleHorizontal,
  RotateCcw,
  Square,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { Markdown } from "@/components/explore/Markdown";
import { PlotlyChart } from "@/components/explore/PlotlyChart";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { fetcher, formatCell, formatDateTime, postJson } from "@/lib/explore/client";
import type { ReportBlock, ReportFigure, ReportInput, ReportTable, ReportTableContent, ReportView, ResolvedReportBlock } from "@/lib/explore/reports";

interface ExploreReportProps {
  scope: string;
  canEdit: boolean;
  /** Switch to the canvas, where outputs are made. */
  onOpenCanvas: () => void;
}

type ReportResponse = { report: ReportView };

function newBlockId(prefix: string): string {
  return `${prefix}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function figureKey(analysisId: string, figureName: string): string {
  return `${analysisId}:${figureName}`;
}

/** The editable shape of a report: what the server stores, without the resolved content. */
function toInput(report: ReportView): ReportInput {
  return {
    title: report.title,
    blocks: report.blocks.map((block): ReportBlock => {
      if (block.type === "text") return { id: block.id, type: "text", markdown: block.markdown, span: block.span };
      if (block.type === "figure") {
        return { id: block.id, type: "figure", analysisId: block.analysisId, figureName: block.figureName, caption: block.caption, span: block.span };
      }
      return { id: block.id, type: "table", datasetId: block.datasetId, caption: block.caption, rows: block.rows, span: block.span };
    }),
  };
}

function figureBlockOf(figure: ReportFigure): ReportBlock {
  return {
    id: `figure:${figure.analysisId}:${figure.figureName}`,
    type: "figure",
    analysisId: figure.analysisId,
    figureName: figure.figureName,
    caption: `${figure.figureName} (${figure.analysisName})`,
    span: 1,
  };
}

function tableBlockOf(table: ReportTable): ReportBlock {
  return { id: `table:${table.datasetId}`, type: "table", datasetId: table.datasetId, caption: table.name, span: 2 };
}

/**
 * The report of a scope: the final page where the outputs of the canvas come
 * together with text. Read-only for viewers; editors arrange blocks, write
 * Markdown and pick which figures and tables to show.
 */
export function ExploreReport({ scope, canEdit, onOpenCanvas }: ExploreReportProps) {
  const key = `/api/explore/reports?targetKey=${encodeURIComponent(scope)}`;
  const scopeQuery = `?scope=${encodeURIComponent(scope)}`;
  const { data, error, isLoading, mutate } = useSWR<ReportResponse>(key, fetcher, { refreshInterval: 15000 });
  const [draft, setDraft] = useState<ReportInput | null>(null);
  const [saving, setSaving] = useState(false);
  const report = data?.report;

  if (error) return <p className="mt-6 text-sm text-destructive">Could not load the report: {String(error.message)}</p>;
  if (!report || (isLoading && !data)) {
    return (
      <div className="mt-6 space-y-3">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const editing = draft !== null;
  const outputTables = report.outputs.tables.filter((table) => table.output);
  const hasOutputs = report.outputs.figures.length + outputTables.length > 0;
  const resolvedById = new Map(report.blocks.map((block) => [block.id, block] as const));
  const figureByKey = new Map(report.outputs.figures.map((figure) => [figureKey(figure.analysisId, figure.figureName), figure] as const));
  const tableById = new Map(report.outputs.tables.map((table) => [table.datasetId, table] as const));
  const blocks: ReportBlock[] = draft ? draft.blocks : report.blocks;
  const usedFigures = new Set(blocks.filter((block) => block.type === "figure").map((block) => figureKey(block.analysisId, block.figureName)));
  const usedTables = new Set(blocks.filter((block) => block.type === "table").map((block) => block.datasetId));

  const update = (mutator: (blocks: ReportBlock[]) => ReportBlock[]) =>
    setDraft((current) => (current ? { ...current, blocks: mutator(current.blocks) } : current));
  const patchBlock = (id: string, patch: Partial<ReportBlock>) =>
    update((current) => current.map((block) => (block.id === id ? ({ ...block, ...patch } as ReportBlock) : block)));
  const moveBlock = (id: string, delta: number) =>
    update((current) => {
      const index = current.findIndex((block) => block.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  const removeBlock = (id: string) => update((current) => current.filter((block) => block.id !== id));
  const addBlock = (block: ReportBlock) => update((current) => (current.some((entry) => entry.id === block.id) ? current : [...current, block]));
  const addAllOutputs = () =>
    update((current) => {
      const have = new Set(current.map((block) => block.id));
      const additions = [...report.outputs.figures.map(figureBlockOf), ...outputTables.map(tableBlockOf)].filter((block) => !have.has(block.id));
      return [...current, ...additions];
    });

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const result = await postJson<ReportResponse>(key, draft, "PUT");
      await mutate(result, { revalidate: false });
      setDraft(null);
      toast.success("Report saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the report");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    try {
      const result = await postJson<ReportResponse>(key, undefined, "DELETE");
      await mutate(result, { revalidate: false });
      setDraft(null);
      toast.success("Report reset to the current outputs");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reset the report");
    }
  };

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              value={draft.title}
              onChange={(event) => setDraft((current) => (current ? { ...current, title: event.target.value } : current))}
              className="max-w-xl text-lg font-semibold"
              aria-label="Report title"
            />
          ) : (
            <h2 className="text-2xl font-semibold tracking-tight">{report.title}</h2>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            {report.draft
              ? "A draft assembled from every output of this scope; nothing is saved until you edit it."
              : `Saved report, last changed ${formatDateTime(report.updatedAt)}.`}{" "}
            Figures and tables follow the latest run of their analysis.
          </p>
        </div>
        {canEdit &&
          (editing ? (
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Plus className="mr-2 h-4 w-4" />
                    Add block
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuItem onSelect={() => addBlock({ id: newBlockId("text"), type: "text", markdown: "" })}>
                    <FileText className="mr-2 h-4 w-4" /> Text
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Figures</DropdownMenuLabel>
                  {report.outputs.figures.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No analysis has drawn a figure yet.</div>}
                  {report.outputs.figures.map((figure) => {
                    const used = usedFigures.has(figureKey(figure.analysisId, figure.figureName));
                    return (
                      <DropdownMenuItem key={figureKey(figure.analysisId, figure.figureName)} disabled={used} onSelect={() => addBlock(figureBlockOf(figure))}>
                        <ImageIcon className="mr-2 h-4 w-4" />
                        <span className="flex-1 truncate">{figure.figureName}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{used ? "added" : figure.analysisName}</span>
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Tables</DropdownMenuLabel>
                  {report.outputs.tables.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No datasets in this scope yet.</div>}
                  {report.outputs.tables.map((table) => {
                    const used = usedTables.has(table.datasetId);
                    return (
                      <DropdownMenuItem key={table.datasetId} disabled={used} onSelect={() => addBlock(tableBlockOf(table))}>
                        <Table2 className="mr-2 h-4 w-4" />
                        <span className="flex-1 truncate">{table.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{used ? "added" : table.output ? "output" : "input"}</span>
                      </DropdownMenuItem>
                    );
                  })}
                  {hasOutputs && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={addAllOutputs}>
                        <Plus className="mr-2 h-4 w-4" /> Add every output not yet on the page
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="sm" onClick={() => setDraft(null)} disabled={saving}>
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {!report.draft && (
                <Button variant="ghost" size="sm" onClick={() => void reset()} title="Forget the saved report and start again from the current outputs">
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Start over
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setDraft(toInput(report))}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit report
              </Button>
            </div>
          ))}
      </div>

      {!hasOutputs && !editing && (
        <div className="mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p>Nothing to report yet. Outputs are made on the canvas: connect a dataset to an analysis and run it, and its figures and tables land here.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={onOpenCanvas}>
            <LayoutGrid className="mr-2 h-4 w-4" />
            Open the canvas
          </Button>
        </div>
      )}

      {(hasOutputs || editing) && (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {blocks.map((block, index) => (
            <ReportBlockCard
              key={block.id}
              block={block}
              resolved={resolvedById.get(block.id)}
              figure={block.type === "figure" ? (figureByKey.get(figureKey(block.analysisId, block.figureName)) ?? null) : null}
              tableInfo={block.type === "table" ? (tableById.get(block.datasetId) ?? null) : null}
              editing={editing}
              first={index === 0}
              last={index === blocks.length - 1}
              onPatch={(patch) => patchBlock(block.id, patch)}
              onMove={(delta) => moveBlock(block.id, delta)}
              onRemove={() => removeBlock(block.id)}
              scopeQuery={scopeQuery}
            />
          ))}
          {editing && blocks.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground md:col-span-2">The page is empty. Add a text block, a figure or a table.</div>
          )}
        </div>
      )}
    </div>
  );
}

interface ReportBlockCardProps {
  block: ReportBlock;
  resolved: ResolvedReportBlock | undefined;
  figure: ReportFigure | null;
  tableInfo: ReportTable | null;
  editing: boolean;
  first: boolean;
  last: boolean;
  onPatch: (patch: Partial<ReportBlock>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
  scopeQuery: string;
}

function ReportBlockCard({ block, resolved, figure, tableInfo, editing, first, last, onPatch, onMove, onRemove, scopeQuery }: ReportBlockCardProps) {
  const span = block.span ?? (block.type === "figure" ? 1 : 2);
  const label = block.type === "text" ? "Text" : block.type === "figure" ? "Figure" : "Table";
  return (
    <section className={cn("min-w-0 rounded-lg border bg-card", span === 2 && "md:col-span-2")} aria-label={`${label} block`}>
      {editing && (
        <div className="flex items-center gap-1 border-b bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
          <span className="font-medium">{label}</span>
          <span className="flex-1" />
          <button type="button" className="rounded p-1 hover:bg-muted hover:text-foreground" onClick={() => onPatch({ span: span === 2 ? 1 : 2 })} title={span === 2 ? "Make half width" : "Make full width"} aria-label={span === 2 ? "Make half width" : "Make full width"}>
            {span === 2 ? <RectangleHorizontal className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          </button>
          <button type="button" className="rounded p-1 hover:bg-muted hover:text-foreground disabled:opacity-40" onClick={() => onMove(-1)} disabled={first} title="Move up" aria-label="Move up">
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="rounded p-1 hover:bg-muted hover:text-foreground disabled:opacity-40" onClick={() => onMove(1)} disabled={last} title="Move down" aria-label="Move down">
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="rounded p-1 hover:bg-muted hover:text-destructive" onClick={onRemove} title="Remove block" aria-label="Remove block">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="p-4">
        {block.type === "text" &&
          (editing ? (
            <Textarea
              value={block.markdown}
              onChange={(event) => onPatch({ markdown: event.target.value })}
              rows={Math.min(16, Math.max(4, block.markdown.split("\n").length + 1))}
              placeholder="Write in Markdown: headings with #, lists with -, emphasis with *"
              className="font-mono text-xs"
              aria-label="Text block"
            />
          ) : block.markdown.trim() ? (
            <Markdown>{block.markdown}</Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">Empty text block.</p>
          ))}

        {block.type === "figure" && (
          <>
            <Caption editing={editing} value={block.caption ?? ""} fallback={block.figureName} onChange={(caption) => onPatch({ caption })} />
            {figure ? (
              <FigureContent figure={figure} scopeQuery={scopeQuery} />
            ) : (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">This figure is not produced by the analysis any more.</div>
            )}
          </>
        )}

        {block.type === "table" && (
          <>
            <Caption editing={editing} value={block.caption ?? ""} fallback={tableInfo?.name ?? "Table"} onChange={(caption) => onPatch({ caption })} />
            {resolved && resolved.type === "table" && resolved.table ? (
              <TableContent table={resolved.table} scopeQuery={scopeQuery} />
            ) : tableInfo ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                {tableInfo.name}: {tableInfo.rowCount.toLocaleString()} rows × {tableInfo.columnCount} columns. The rows appear once the report is saved.
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">This table is not available in this scope any more.</div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Caption({ editing, value, fallback, onChange }: { editing: boolean; value: string; fallback: string; onChange: (value: string) => void }) {
  if (editing) {
    return <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={fallback} className="mb-3 h-8 text-sm font-medium" aria-label="Caption" />;
  }
  return <h3 className="mb-3 text-sm font-semibold">{value || fallback}</h3>;
}

function InteractiveFigure({ url }: { url: string }) {
  const { data, error } = useSWR<{ data?: unknown[]; layout?: Record<string, unknown> }>(url, fetcher);
  if (error) return <p className="text-sm text-destructive">Could not load the figure.</p>;
  if (!data) return <Skeleton className="h-72 w-full" />;
  return <PlotlyChart data={Array.isArray(data.data) ? data.data : []} layout={{ ...(data.layout ?? {}), autosize: true }} height={380} className="w-full" />;
}

function FigureContent({ figure, scopeQuery }: { figure: ReportFigure; scopeQuery: string }) {
  const image = figure.thumbnailUrl ?? (figure.format === "png" || figure.format === "svg" ? figure.url : null);
  return (
    <figure>
      {figure.format === "plotly-json" ? (
        <InteractiveFigure url={figure.url} />
      ) : image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt={figure.figureName} className="mx-auto max-h-[480px] max-w-full object-contain" />
      ) : (
        <a href={figure.url} className="text-sm underline" target="_blank" rel="noreferrer">
          Open figure
        </a>
      )}
      <figcaption className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>{figure.analysisName}</span>
        <span>{figure.runNumber}</span>
        {figure.unchanged && <span>unchanged since the previous run</span>}
        <span className="flex-1" />
        <Link href={`/explore/runs/${figure.runId}${scopeQuery}`} className="inline-flex items-center gap-1 hover:underline">
          Run <ExternalLink className="h-3 w-3" />
        </Link>
      </figcaption>
    </figure>
  );
}

function TableContent({ table, scopeQuery }: { table: ReportTableContent; scopeQuery: string }) {
  return (
    <div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-left">
            <tr>
              {table.columns.map((column) => (
                <th key={column.key} className="whitespace-nowrap px-2 py-1.5 font-medium" title={column.key}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={index} className="border-t">
                {table.columns.map((column) => (
                  <td key={column.key} className={cn("whitespace-nowrap px-2 py-1", column.type === "number" && "text-right tabular-nums")}>
                    {formatCell(row[column.key])}
                  </td>
                ))}
              </tr>
            ))}
            {table.rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-muted-foreground" colSpan={Math.max(1, table.columns.length)}>
                  No rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="tabular-nums">
          {Math.min(table.rows.length, table.rowCount).toLocaleString()} of {table.rowCount.toLocaleString()} rows, {table.columnCount} columns
          {table.version ? `, v${table.version}` : ""}
        </span>
        <span className="flex-1" />
        <Link href={`/explore/datasets/${table.datasetId}${scopeQuery}`} className="inline-flex items-center gap-1 hover:underline">
          Open table <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
