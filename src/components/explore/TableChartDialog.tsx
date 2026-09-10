"use client";

import { useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Check, ChevronDown, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PlotlyChart } from "./PlotlyChart";
import { ExploreLoading } from "./ExploreLoading";
import { Sketch } from "./ElementStore";
import { fetcher } from "@/lib/explore/client";
import { CHART_KIND_LABELS, type ChartKind, type ReportBlock } from "@/lib/explore/report-blocks";
import { chartChoices, initialChartSpec, type ChartTable } from "@/lib/explore/report-source-actions";
import { suggestCharts, suggestedChartTitle } from "@/lib/explore/chart-suggestions";
import { buildChart, chartColumnLabel, type ChartSpec } from "@/lib/explore/report-widgets";
import type { TableFrame } from "./ReportWidgets";

interface Props {
  tables: ChartTable[];
  initialDatasetId?: string;
  initialChart?: ChartKind;
  onClose: () => void;
  onAdd: (block: ReportBlock) => void | Promise<void>;
}

function sameSpec(a: ChartSpec, b: ChartSpec): boolean {
  return a.chart === b.chart && a.x === b.x && a.y === b.y && a.color === b.color;
}

export function TableChartDialog({ tables: availableTables, initialDatasetId, initialChart, onClose, onAdd }: Props) {
  // A background poll must not change the source version being reviewed.
  const [tables] = useState(availableTables);
  const [chosen, setChosen] = useState(initialDatasetId ?? "");
  const table = tables.find(entry => entry.datasetId === chosen);
  const [selection, setSelection] = useState<{ datasetId: string; spec: ChartSpec } | null>(null);
  const [customTitle, setCustomTitle] = useState<{ datasetId: string; value: string } | null>(null);
  const [customizing, setCustomizing] = useState(Boolean(initialChart));
  const columns = useMemo(() => table?.columns.filter(column => !column.key.endsWith("_db_id")) ?? [], [table]);
  const choices = useMemo(() => chartChoices(columns), [columns]);
  const { data: frame, error, mutate } = useSWR<TableFrame>(table ? `/api/explore/datasets/${encodeURIComponent(table.datasetId)}/table?limit=2000` : null, fetcher, { keepPreviousData: false });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inFlight = useRef(false);
  const blockId = useRef(`chart:${crypto.randomUUID()}`);
  const matchingFrame = frame?.datasetId === table?.datasetId && frame?.version === table?.version ? frame : null;
  const changed = Boolean(frame && table && !matchingFrame);
  const suggestions = useMemo(() => matchingFrame ? suggestCharts(columns, matchingFrame.rows).filter(suggestion => choices.includes(suggestion.spec.chart)) : [], [columns, matchingFrame, choices]);
  const suggested = initialChart ? suggestions.find(suggestion => suggestion.spec.chart === initialChart) : suggestions[0];
  const spec = selection?.datasetId === chosen ? selection.spec : suggested?.spec ?? initialChartSpec(columns, initialChart);
  const title = customTitle?.datasetId === chosen ? customTitle.value : suggestedChartTitle(columns, spec);
  const preview = matchingFrame && choices.includes(spec.chart) ? buildChart(matchingFrame.rows, columns, spec, matchingFrame.truncated ? matchingFrame.total : undefined) : null;
  const setSpec = (next: ChartSpec) => { setSelection({ datasetId: chosen, spec: next }); setProblem(null); };
  const valid = Boolean(table && preview?.data.length && choices.includes(spec.chart) && title.trim() && !error && !changed);
  const add = async () => {
    if (!table || !valid || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await onAdd({ id: blockId.current, type: "chart", datasetId: table.datasetId, ...spec, caption: title.trim(), span: 2 });
      onClose();
    } catch (error) { setProblem(error instanceof Error ? error.message : "Could not add the chart."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const selectClass = "mt-1 w-full min-w-0 rounded-md border bg-background p-2 text-sm";
  const columnSelect = (label: string, key: "x" | "y" | "color", numeric = false) => <label className="min-w-0 text-xs font-medium">{label}<select aria-label={label} className={selectClass} value={spec[key] ?? ""} disabled={busy} onChange={event => setSpec({ ...spec, [key]: event.target.value || undefined })}>
    {key === "color" && <option value="">None</option>}
    {columns.filter(column => numeric ? column.type === "number" : key === "color" ? column.type !== "number" && column.type !== "json" : column.type !== "json").map(column => <option key={column.key} value={column.key}>{chartColumnLabel(column)}</option>)}
  </select></label>;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="flex max-h-[90dvh] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
      <DialogHeader className="shrink-0 px-5 pb-4 pt-5 pr-12 text-left"><DialogTitle>Create chart from a table</DialogTitle><DialogDescription>Preview a suggested view or choose your own settings. Nothing is added until you confirm.</DialogDescription></DialogHeader>
      <div className="min-h-0 space-y-4 overflow-y-auto px-5 pb-5">
        <label className="block text-sm font-medium">Source table<select aria-label="Source table" className={selectClass} value={chosen} disabled={busy} onChange={event => { setChosen(event.target.value); setSelection(null); setCustomTitle(null); setCustomizing(Boolean(initialChart)); setProblem(null); }}><option value="">Choose a table…</option>{tables.map(entry => <option key={entry.datasetId} value={entry.datasetId}>{entry.name} · {entry.rowCount} {entry.rowCount === 1 ? "row" : "rows"}</option>)}</select></label>
        {!tables.length && <p className="text-sm text-muted-foreground">Add metadata or a pipeline table from Browse data first.</p>}
        {table && !choices.length && <p className="text-sm text-muted-foreground">This table has no columns suitable for a chart. Choose a table with text or numeric columns, or add it to the page as a table.</p>}
        {table && choices.length > 0 && <>
          <p className="text-xs text-muted-foreground">{table.rowCount.toLocaleString()} {table.rowCount === 1 ? "row" : "rows"} · version {table.version ?? "—"}{matchingFrame?.rowEntity ? ` · Each row represents: ${matchingFrame.rowEntity.replace(/[-_]/g, " ")}` : ""}. Charts use saved values from this table.</p>
          {error ? <div role="alert" className="text-sm">Could not load the table. <Button size="sm" variant="outline" onClick={() => void mutate()}>Retry preview</Button></div>
            : changed ? <p role="alert" className="text-sm">This table changed while you were choosing. Close and reopen the picker to review its latest columns.</p>
              : !matchingFrame ? <ExploreLoading variant="chart" label="Finding views for this table…" height={300} />
                : <>
                  {suggestions.length > 0 && <section aria-label="Suggested chart views" className="space-y-2">
                    <h3 className="text-xs font-medium text-muted-foreground">Suggested views</h3>
                    <div className={cn("grid gap-2", suggestions.length === 2 ? "sm:grid-cols-2" : suggestions.length === 3 ? "sm:grid-cols-3" : "")}>
                      {suggestions.map(suggestion => {
                        const selected = sameSpec(spec, suggestion.spec);
                        return <button key={suggestion.id} type="button" aria-label={suggestion.label} aria-pressed={selected} disabled={busy} onClick={() => setSpec(suggestion.spec)} className={cn("group relative flex min-w-0 items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:flex-col sm:items-start sm:gap-1.5", selected ? "border-primary bg-primary/5" : "bg-card hover:border-primary/40 hover:bg-muted/30")}>
                          <Sketch kind={suggestion.spec.chart === "values" ? "bar" : suggestion.spec.chart} className={cn("h-8 w-14 shrink-0 sm:h-9", selected ? "text-primary" : "text-muted-foreground")} />
                          {selected && <Check aria-hidden="true" className="absolute right-2 top-2 h-3.5 w-3.5 text-primary" />}
                          <span className="min-w-0"><span className="block pr-3 text-sm font-medium">{suggestion.label}</span><span className="mt-0.5 block text-xs text-muted-foreground">{suggestion.description}</span></span>
                        </button>;
                      })}
                    </div>
                    {matchingFrame.truncated && <p className="text-xs text-muted-foreground">Suggestions use the first {matchingFrame.rows.length.toLocaleString()} of {matchingFrame.total.toLocaleString()} rows, not the whole table.</p>}
                  </section>}
                  <label className="block text-xs font-medium">Chart title<Input className="mt-1" aria-label="Chart title" maxLength={500} value={title} disabled={busy} onChange={event => setCustomTitle({ datasetId: chosen, value: event.target.value })} /></label>
                  {suggestions.length > 0 && <Button type="button" variant="ghost" size="sm" className="-ml-2" aria-expanded={customizing} aria-controls="chart-custom-settings" onClick={() => setCustomizing(!customizing)}><Settings2 className="mr-1.5 h-3.5 w-3.5" />Customize chart<ChevronDown className={cn("ml-1.5 h-3.5 w-3.5 transition-transform", customizing && "rotate-180")} /></Button>}
                  {(customizing || !suggestions.length) && <div id="chart-custom-settings" className="space-y-3 rounded-lg border bg-muted/20 p-3">
                    <label className="block text-xs font-medium">Chart type<select aria-label="Chart type" className={selectClass} value={spec.chart} disabled={busy} onChange={event => { const kind = event.target.value as ChartKind; setSpec(suggestions.find(suggestion => suggestion.spec.chart === kind)?.spec ?? initialChartSpec(columns, kind)); }}>{choices.map(chart => <option key={chart} value={chart}>{CHART_KIND_LABELS[chart].label}</option>)}</select></label>
                    <p className="text-xs text-muted-foreground">{CHART_KIND_LABELS[spec.chart].description}</p>
                    <div className="grid gap-3 sm:grid-cols-2">{columnSelect(spec.chart === "histogram" || spec.chart === "scatter" ? "X axis" : "Labels / groups", "x", spec.chart === "histogram" || spec.chart === "scatter")}{CHART_KIND_LABELS[spec.chart].needsY && columnSelect("Measurement", "y", true)}{spec.chart !== "box" && columnSelect("Colour by", "color")}</div>
                  </div>}
                  {preview?.data.length ? <div className="min-w-0 rounded-lg border bg-card p-2" role="region" aria-label="Chart preview"><PlotlyChart data={preview.data} layout={preview.layout} height={250} /></div>
                    : <p className="rounded-lg border border-dashed p-5 text-sm">{preview?.notes[0] ?? "No measurements to draw with this selection."}</p>}
                  {preview?.notes.filter((_, i) => Boolean(preview.data.length) || i > 0).map(note => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
                </>}
        </>}
        {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t px-5 py-4"><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={!valid || busy} onClick={() => void add()}>{busy ? "Adding…" : "Add chart to page"}</Button></div>
    </DialogContent>
  </Dialog>;
}
