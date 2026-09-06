"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Filter, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PlotlyChart } from "@/components/explore/PlotlyChart";
import { SubjectCompositionPanel } from "@/components/explore/views/SubjectComposition";
import { cn } from "@/lib/utils";
import { fetcher, formatCell, ROLE_LABELS } from "@/lib/explore/client";
import { applyFilters, cellText, distinctValues, groupBy, median, relativeAbundance, toNumber, type ActiveFilters } from "@/lib/explore/frame";
import type { ReportFilter } from "@/lib/explore/report-blocks";
import { formatStat } from "@/lib/explore/report-widgets";
import { formatWithDigits, metricTrend, sparklinePoints, trendNote, type TrendMode } from "@/lib/explore/metric-trend";
import { measureText, parseMeasure, suggestMeasure, timelineNote, type AnalysisTimeline, type TimeAxis, type TimelineMeasure, type TimelineSeries } from "@/lib/explore/time-axis";
import type { ReportAnalysis, ReportTable } from "@/lib/explore/reports";
import type { ExploreColumn, ExploreRowData } from "@/lib/explore/types";

// ---------------------------------------------------------------------------
// Data: whole tables and distinct values, fetched once and shared by SWR.
// ---------------------------------------------------------------------------

export interface TableFrame {
  datasetId: string;
  version: number | null;
  columns: ExploreColumn[];
  rows: ExploreRowData[];
  total: number;
  truncated: boolean;
}

/** The whole table (up to the server's cap) for blocks that compute in the browser. */
export function useTableFrame(datasetId: string | null) {
  return useSWR<TableFrame>(datasetId ? `/api/explore/datasets/${datasetId}/table` : null, fetcher, { revalidateOnFocus: false });
}

export function useDistinct(datasetId: string | null, column: string | null) {
  return useSWR<{ values: Array<{ value: string; count: number }>; truncated: boolean }>(
    datasetId && column ? `/api/explore/datasets/${datasetId}/distinct?column=${encodeURIComponent(column)}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );
}

/** Rows of a frame after the page filters that apply to it. */
export function filteredRows(frame: TableFrame, filters: ReportFilter[], active: ActiveFilters): ExploreRowData[] {
  return applyFilters(frame.rows, new Set(frame.columns.map((column) => column.key)), filters, active);
}

export function columnLabel(columns: ExploreColumn[], key: string): string {
  return columns.find((column) => column.key === key)?.label ?? key;
}

/** True when at least one active page filter names a column of this table. */
export function filtersApply(table: { columns: ExploreColumn[] } | null, filters: ReportFilter[], active: ActiveFilters): boolean {
  if (!table) return false;
  const keys = new Set(table.columns.map((column) => column.key));
  return filters.some((filter) => keys.has(filter.column) && (active[filter.id]?.length ?? 0) > 0);
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

const ALL = "__all__";

function FilterControl({ filter, tables, value, onChange, editing, onRemove }: { filter: ReportFilter; tables: ReportTable[]; value: string | null; onChange: (value: string | null) => void; editing: boolean; onRemove?: () => void }) {
  const table = tables.find((entry) => entry.datasetId === filter.datasetId) ?? null;
  const { data } = useDistinct(filter.datasetId, filter.column);
  const label = filter.label || (table ? columnLabel(table.columns, filter.column) : filter.column);
  return (
    <div className="flex items-center gap-1">
      <Select value={value ?? ALL} onValueChange={(next) => onChange(next === ALL ? null : next)}>
        <SelectTrigger className="h-8 min-w-40 text-xs" aria-label={label}>
          <span className="mr-1 text-muted-foreground">{label}:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {(data?.values ?? []).map((entry) => (
            <SelectItem key={entry.value} value={entry.value}>
              {entry.value}
              <span className="ml-1.5 text-xs text-muted-foreground">{entry.count.toLocaleString()}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {editing && onRemove && (
        <button type="button" onClick={onRemove} className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label={`Remove filter ${label}`} title="Remove this filter">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * The page filters: readers narrow every block that reads a table with the
 * filter's column; editors add or remove filters (a table plus one of its columns).
 */
export function FilterBar({
  filters,
  tables,
  active,
  onActiveChange,
  editing,
  onFiltersChange,
}: {
  filters: ReportFilter[];
  tables: ReportTable[];
  active: ActiveFilters;
  onActiveChange: (active: ActiveFilters) => void;
  editing: boolean;
  onFiltersChange?: (filters: ReportFilter[]) => void;
}) {
  const [adding, setAdding] = useState<{ datasetId: string; column: string } | null>(null);
  if (filters.length === 0 && !editing) return null;
  const candidates = tables.filter((table) => table.columns.some((column) => column.type !== "number"));
  const addTable = adding ? tables.find((table) => table.datasetId === adding.datasetId) : null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
      <Filter className="h-4 w-4 text-muted-foreground" />
      {filters.length === 0 && <span className="text-xs text-muted-foreground">No page filters yet. A filter narrows every block that reads the chosen column.</span>}
      {filters.map((filter) => (
        <FilterControl
          key={filter.id}
          filter={filter}
          tables={tables}
          value={active[filter.id]?.[0] ?? null}
          onChange={(value) => onActiveChange({ ...active, [filter.id]: value ? [value] : [] })}
          editing={editing}
          onRemove={onFiltersChange ? () => onFiltersChange(filters.filter((entry) => entry.id !== filter.id)) : undefined}
        />
      ))}
      {Object.values(active).some((values) => values.length > 0) && (
        <button type="button" onClick={() => onActiveChange({})} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
          Clear
        </button>
      )}
      {editing && onFiltersChange && filters.length < 6 && (
        <div className="flex items-center gap-1">
          <Select value={adding?.datasetId ?? ""} onValueChange={(datasetId) => setAdding({ datasetId, column: "" })}>
            <SelectTrigger className="h-8 text-xs" aria-label="Table for a new filter">
              <SelectValue placeholder="Add filter: table" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((table) => (
                <SelectItem key={table.datasetId} value={table.datasetId}>{table.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {addTable && (
            <Select
              value={adding?.column ?? ""}
              onValueChange={(column) => {
                onFiltersChange([...filters, { id: `filter:${addTable.datasetId}:${column}`, datasetId: addTable.datasetId, column, label: columnLabel(addTable.columns, column) }]);
                setAdding(null);
              }}
            >
              <SelectTrigger className="h-8 text-xs" aria-label="Column for a new filter">
                <SelectValue placeholder="column" />
              </SelectTrigger>
              <SelectContent>
                {addTable.columns
                  .filter((column) => column.type !== "number")
                  .map((column) => (
                    <SelectItem key={column.key} value={column.key}>{column.label}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

/** A searchable list for long lists of names: a text box and the best matches. */
function NamePicker({ label, names, value, onChange, hint }: { label: string; names: Array<{ name: string; hint?: string }>; value: string | null; onChange: (name: string) => void; hint?: string }) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const lower = query.trim().toLowerCase();
    return names.filter((entry) => !lower || entry.name.toLowerCase().includes(lower)).slice(0, 12);
  }, [names, query]);
  return (
    <div className="mb-3 rounded-md border bg-muted/30 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Find in ${names.length.toLocaleString()}`} className="h-7 w-48 text-xs" aria-label={label} />
        {value && <span className="text-xs font-medium">{value}</span>}
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {(query || !value) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {matches.map((entry) => (
            <button
              key={entry.name}
              type="button"
              onClick={() => {
                onChange(entry.name);
                setQuery("");
              }}
              className={cn("rounded-full border px-2 py-0.5 text-[11px] hover:bg-muted", entry.name === value && "border-transparent bg-secondary font-medium")}
              title={entry.hint}
            >
              {entry.name}
              {entry.hint && <span className="ml-1 text-muted-foreground">{entry.hint}</span>}
            </button>
          ))}
          {matches.length === 0 && <span className="text-[11px] text-muted-foreground">No match.</span>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Taxon explorer: one organism across the cohort
// ---------------------------------------------------------------------------

const GROUP_PALETTE = ["#4C72B0", "#DD8452", "#55A868", "#C44E52", "#8172B3", "#937860", "#DA8BC3", "#8C8C8C", "#CCB974", "#64B5CD"];

export function TaxonExplorerView({
  table,
  taxon,
  onPickTaxon,
  filters,
  active,
  editing,
}: {
  table: ReportTable;
  taxon: string | null;
  onPickTaxon: (taxon: string) => void;
  filters: ReportFilter[];
  active: ActiveFilters;
  editing: boolean;
}) {
  const roles = table.roles;
  const { data: frame, error } = useTableFrame(roles.sample && roles.taxon && roles.count ? table.datasetId : null);
  const [picked, setPicked] = useState<string | null>(null);
  const current = picked ?? taxon ?? null;

  const rows = useMemo(() => (frame ? filteredRows(frame, filters, active) : []), [frame, filters, active]);
  const ra = useMemo(() => (roles.sample && roles.count ? relativeAbundance(rows, roles.sample, roles.count) : new Map<ExploreRowData, number>()), [rows, roles.sample, roles.count]);
  const taxa = useMemo(() => {
    if (!roles.taxon || !roles.sample) return [];
    const samplesByTaxon = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!ra.has(row)) continue;
      const name = cellText(row[roles.taxon]);
      const set = samplesByTaxon.get(name) ?? new Set<string>();
      set.add(cellText(row[roles.sample]));
      samplesByTaxon.set(name, set);
    }
    return [...samplesByTaxon.entries()].sort((a, b) => b[1].size - a[1].size).map(([name, samples]) => ({ name, hint: `${samples.size}` }));
  }, [rows, ra, roles.taxon, roles.sample]);

  if (!roles.sample || !roles.taxon || !roles.count) {
    return <p className="text-sm text-muted-foreground">{table.name} needs sample, taxon and count roles for a taxon explorer.</p>;
  }
  if (error) return <p className="text-sm text-destructive">Could not load the table.</p>;
  if (!frame) return <Skeleton className="h-64 w-full" />;

  const sampleKey = roles.sample;
  const groupKey = roles.group ?? null;
  const subjectKey = roles.subject ?? null;
  const timeKey = roles.timepoint ?? null;
  const allSamples = groupBy(rows, sampleKey);
  const sampleGroup = new Map<string, string>();
  for (const [sample, list] of allSamples) sampleGroup.set(sample, groupKey ? cellText(list[0][groupKey]) || "(none)" : "all");
  const hits = current ? rows.filter((row) => cellText(row[roles.taxon!]) === current && ra.has(row)) : [];
  const hitSamples = new Map<string, { ra: number; row: ExploreRowData }>();
  for (const row of hits) {
    const sample = cellText(row[sampleKey]);
    const existing = hitSamples.get(sample);
    const value = ra.get(row) ?? 0;
    if (!existing || existing.ra < value) hitSamples.set(sample, { ra: value, row });
  }
  const groups = [...new Set([...sampleGroup.values()])];
  const perGroup = groups.map((group, index) => {
    const total = [...sampleGroup.values()].filter((entry) => entry === group).length;
    const present = [...hitSamples.entries()].filter(([sample]) => sampleGroup.get(sample) === group);
    return { group, colour: GROUP_PALETTE[index % GROUP_PALETTE.length], total, present: present.length, prevalence: total ? (100 * present.length) / total : 0, ras: present.map(([, entry]) => entry.ra) };
  });
  const subjectsWithHit = subjectKey ? new Set([...hitSamples.values()].map((entry) => cellText(entry.row[subjectKey]))) : null;

  return (
    <div>
      <NamePicker label="Organism" names={taxa} value={current} onChange={(name) => { setPicked(name); if (editing) onPickTaxon(name); }} hint={current ? `${hitSamples.size} of ${allSamples.size} samples` : undefined} />
      {current && hitSamples.size > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <PlotlyChart
              data={[{ type: "bar", x: perGroup.map((entry) => `${entry.group} (n=${entry.total})`), y: perGroup.map((entry) => entry.prevalence), marker: { color: perGroup.map((entry) => entry.colour) }, hovertemplate: "%{x}<br>present in %{y:.1f} % of samples<extra></extra>" }]}
              layout={{ title: { text: "Prevalence per group", font: { size: 12 } }, yaxis: { title: { text: "% of samples" }, range: [0, 100] }, margin: { l: 48, r: 8, t: 30, b: 60 }, showlegend: false }}
              height={260}
              className="w-full"
            />
          </div>
          <div>
            <PlotlyChart
              data={perGroup.filter((entry) => entry.ras.length > 0).map((entry) => ({ type: "box", name: entry.group, y: entry.ras, boxpoints: "all", jitter: 0.4, pointpos: 0, marker: { size: 4, color: entry.colour }, line: { color: entry.colour } }))}
              layout={{ title: { text: "Relative abundance when present", font: { size: 12 } }, yaxis: { title: { text: "%" }, type: "log" }, margin: { l: 48, r: 8, t: 30, b: 40 }, showlegend: false }}
              height={260}
              className="w-full"
            />
          </div>
          {subjectKey && timeKey && (
            <div className="md:col-span-2">
              <PlotlyChart
                data={perGroup.map((entry) => {
                  const points = [...hitSamples.values()].filter((hit) => (groupKey ? cellText(hit.row[groupKey]) || "(none)" : "all") === entry.group);
                  return { type: "scatter", mode: "markers", name: entry.group, x: points.map((hit) => toNumber(hit.row[timeKey]) ?? hit.row[timeKey]), y: points.map((hit) => cellText(hit.row[subjectKey])), marker: { size: 7, color: entry.colour }, text: points.map((hit) => `${hit.ra.toFixed(2)} %`), hovertemplate: "%{y}<br>%{x}: %{text}<extra>" + entry.group + "</extra>" };
                })}
                layout={{ title: { text: `Carriers on the timeline (${subjectsWithHit?.size ?? 0} subjects)`, font: { size: 12 } }, xaxis: { title: { text: columnLabel(frame.columns, timeKey) } }, yaxis: { title: { text: columnLabel(frame.columns, subjectKey) }, tickfont: { size: 9 }, type: "category" }, margin: { l: 80, r: 8, t: 30, b: 40 }, legend: { orientation: "h", y: -0.2 } }}
                height={Math.min(520, Math.max(220, 16 * (subjectsWithHit?.size ?? 0) + 100))}
                className="w-full"
              />
            </div>
          )}
        </div>
      ) : current ? (
        <p className="text-sm text-muted-foreground">{current} is not present in the rows the page filters leave.</p>
      ) : (
        <p className="text-sm text-muted-foreground">Pick an organism to see where it occurs.</p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        {table.name}
        {frame.truncated ? `, first ${frame.rows.length.toLocaleString()} of ${frame.total.toLocaleString()} rows` : ""}
        {filtersApply(table, filters, active) ? ", page filters applied" : ""}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subject: one subject's composition over time
// ---------------------------------------------------------------------------

export function SubjectView({
  table,
  subject,
  measure,
  onPickSubject,
  filters,
  active,
  editing,
}: {
  table: ReportTable;
  subject: string | null;
  measure: "ra" | "reads";
  onPickSubject: (subject: string) => void;
  filters: ReportFilter[];
  active: ActiveFilters;
  editing: boolean;
}) {
  const roles = table.roles;
  const ready = Boolean(roles.sample && roles.subject && roles.timepoint && roles.taxon && roles.count);
  const { data: frame, error } = useTableFrame(ready ? table.datasetId : null);
  const [picked, setPicked] = useState<string | null>(null);
  const current = picked ?? subject ?? null;
  const rows = useMemo(() => (frame ? filteredRows(frame, filters, active) : []), [frame, filters, active]);
  const subjects = useMemo(() => {
    if (!roles.subject || !roles.sample) return [];
    const samples = new Map<string, Set<string>>();
    for (const row of rows) {
      const name = cellText(row[roles.subject]);
      if (!name) continue;
      const set = samples.get(name) ?? new Set<string>();
      set.add(cellText(row[roles.sample]));
      samples.set(name, set);
    }
    return [...samples.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0])).map(([name, set]) => ({ name, hint: `${set.size}` }));
  }, [rows, roles.subject, roles.sample]);
  if (!ready) return <p className="text-sm text-muted-foreground">{table.name} needs sample, subject, timepoint, taxon and count roles for a subject view.</p>;
  if (error) return <p className="text-sm text-destructive">Could not load the table.</p>;
  if (!frame) return <Skeleton className="h-64 w-full" />;
  const groupKey = roles.group ?? null;
  const allGroups = groupKey ? distinctValues(rows, groupKey).map((entry) => entry.value).slice(0, 2) : [];
  const subjectGroups = current && groupKey ? distinctValues(rows.filter((row) => cellText(row[roles.subject!]) === current), groupKey).map((entry) => entry.value).filter((group) => allGroups.includes(group)) : allGroups.length ? [] : [""];
  return (
    <div>
      <NamePicker label="Subject" names={subjects} value={current} onChange={(name) => { setPicked(name); if (editing) onPickSubject(name); }} />
      {current ? (
        <div className="space-y-3">
          {(groupKey ? subjectGroups : [""]).map((group) => (
            <SubjectCompositionPanel key={group} datasetId={table.datasetId} subject={current} group={group} groups={allGroups} measure={measure} height={300} />
          ))}
          {groupKey && subjectGroups.length === 0 && <p className="text-sm text-muted-foreground">{current} has no samples in the primary groups ({allGroups.join(", ")}).</p>}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Pick a subject to see its composition over time.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run metrics as numbers
// ---------------------------------------------------------------------------

export interface KeyFigureOptions {
  metrics: string[];
  labels?: Record<string, string>;
  digits?: Record<string, number>;
  columns?: number;
  trend?: TrendMode;
  trends?: Record<string, TrendMode>;
  timeline?: Record<string, string>;
}

/** The trend a figure shows: its own choice, else the block's default. */
export function figureTrend(options: Pick<KeyFigureOptions, "trend" | "trends">, key: string): TrendMode {
  return options.trends?.[key] ?? options.trend ?? "none";
}

/** What a figure counts along the table's timeline: the author's choice, else a suggestion from its name. */
export function figureMeasure(options: Pick<KeyFigureOptions, "timeline">, key: string, source: AnalysisTimeline | null): TimelineMeasure | null {
  if (!source) return null;
  return parseMeasure(options.timeline?.[key]) ?? suggestMeasure(key, source.roles);
}

/**
 * Key figures: the numbers an analysis recorded, as cards. Each card can
 * carry the author's label and decimals, and a trend: the change since the
 * previous run, a sparkline over the run history, or the figure along the
 * time axis of the table the analysis reads.
 */
export function RunMetricView({ analysis, timelineSource, ...options }: { analysis: ReportAnalysis | null; timelineSource: AnalysisTimeline | null } & KeyFigureOptions) {
  const { metrics, labels, digits, columns } = options;
  if (!analysis) return <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">This analysis is gone.</div>;
  if (!analysis.runNumber) return <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{analysis.name} has not finished a run yet.</div>;
  const perRow = columns ?? Math.min(4, metrics.length);
  return (
    <div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(perRow, 6))}, minmax(0, 1fr))` }}>
        {metrics.map((key) => {
          const value = analysis.metrics[key];
          const format = (amount: number) => formatWithDigits(amount, digits?.[key], formatStat);
          const text = typeof value === "number" ? format(value) : value === null || value === undefined ? "n/a" : formatCell(value);
          const mode = figureTrend(options, key);
          const measure = mode === "timeline" ? figureMeasure(options, key, timelineSource) : null;
          const movement = typeof value === "number" ? metricTrend(analysis.history, key, mode) : null;
          const note = trendNote(movement, mode, format);
          const label = labels?.[key]?.trim() || metricLabel(key);
          return (
            <div key={key} className="rounded-md border bg-muted/20 px-3 py-2">
              <div className="flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xl font-semibold tabular-nums" title={typeof value === "number" ? String(value) : text}>{text}</div>
                  <div className="truncate text-[11px] text-muted-foreground" title={key}>{label}</div>
                </div>
                {mode === "history" && movement && movement.series.length >= 2 && <Sparkline values={movement.series.map((point) => point.value)} />}
              </div>
              {mode === "timeline" && timelineSource && measure && <TimelineSpark source={timelineSource} measure={measure} format={format} />}
              {mode === "timeline" && (!timelineSource || !measure) && (
                <div className="mt-1 truncate text-[11px] text-muted-foreground">{timelineSource ? "choose what this figure counts along the timeline" : "the analysis reads no table with a timeline"}</div>
              )}
              {(mode === "previous" || mode === "history") && (
                <div className={cn("mt-1 truncate text-[11px] tabular-nums", movement?.delta ? (movement.delta > 0 ? "text-emerald-700" : "text-rose-700") : "text-muted-foreground")} title={movement?.since ? `Compared with ${movement.since.runNumber}` : undefined}>
                  {note}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{analysis.name}, {analysis.runNumber}</p>
    </div>
  );
}

/** A tiny line over the run history; the last point is marked. */
function Sparkline({ values }: { values: number[] }) {
  const points = sparklinePoints(values, 64, 24);
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  return (
    <svg viewBox="0 0 64 24" className="h-6 w-16 shrink-0 text-muted-foreground" aria-hidden="true">
      <polyline points={points.map((point) => point.join(",")).join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2" fill="currentColor" />
    </svg>
  );
}

/** The figure along the table's time axis: cumulative sparkline plus what the last stretch added. */
function TimelineSpark({ source, measure, format }: { source: AnalysisTimeline; measure: TimelineMeasure; format: (value: number) => string }) {
  const { data, error } = useSWR<{ axis: TimeAxis | null; series: TimelineSeries | null }>(
    `/api/explore/datasets/${source.datasetId}/views/timeline?measure=${encodeURIComponent(measureText(measure))}`,
    fetcher,
    { revalidateOnFocus: false }
  );
  if (error) return <div className="mt-1 truncate text-[11px] text-destructive">timeline unavailable</div>;
  if (!data) return <Skeleton className="mt-1 h-6 w-full" />;
  const series = data.series;
  if (!series || series.buckets.length < 2) return <div className="mt-1 truncate text-[11px] text-muted-foreground">too few points along the {source.axis.label}s</div>;
  const points = sparklinePoints(series.buckets.map((bucket) => bucket.cumulative), 160, 24);
  const last = points[points.length - 1];
  const note = timelineNote(series, format);
  const first = series.buckets[0];
  const end = series.buckets[series.buckets.length - 1];
  return (
    <div className="mt-1" title={`${measure.kind === "count" ? "rows" : `${measure.kind} of ${measure.column}`} per ${series.step} ${source.axis.kind === "day" ? "study days" : "days"} in ${source.tableName}; ${series.rowsWithoutTime} rows without a ${source.axis.label}`}>
      <svg viewBox="0 0 160 24" className="h-6 w-full text-muted-foreground" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={points.map((point) => point.join(",")).join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={last[0]} cy={last[1]} r="2" fill="currentColor" />
      </svg>
      <div className="flex justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="truncate">{first.label}</span>
        <span className="truncate tabular-nums">{note ?? end.label}</span>
      </div>
    </div>
  );
}

/** "permanova_group_p" reads as "permanova group p"; role words get their labels. */
export function metricLabel(key: string): string {
  return key
    .split("_")
    .map((part) => (part in ROLE_LABELS ? ROLE_LABELS[part as keyof typeof ROLE_LABELS] : part))
    .join(" ");
}

/** Median of a numeric column over rows, for callers that want one number. */
export function medianOf(rows: ExploreRowData[], key: string): number | null {
  return median(rows.map((row) => toNumber(row[key])).filter((value): value is number => value !== null));
}

// ---------------------------------------------------------------------------
// Organisms of interest: the curated taxa a long profile table contains
// ---------------------------------------------------------------------------

export interface CurationListSummary {
  listId: string;
  label: string;
  role: "pathogen" | "flora" | "artifact";
  site: string | null;
  tier: string | null;
  color: string | null;
  entries: Array<{ name: string }>;
}

/** The curation lists of a scope, shared by every block that marks organisms. */
export function useCurationLists(scope: string | null) {
  return useSWR<{ lists: CurationListSummary[] }>(scope ? `/api/explore/curation?targetKey=${encodeURIComponent(scope)}` : null, fetcher, { revalidateOnFocus: false });
}

export type CuratedRoleFilter = "pathogen" | "flora" | "all";

interface CuratedHit {
  name: string;
  lists: CurationListSummary[];
  samples: Set<string>;
  subjects: Set<string>;
  groups: Map<string, Set<string>>;
  peak: number;
  peakGroup: string | null;
}

export function listColor(list: { role: string; color: string | null }): string {
  return list.color ?? (list.role === "pathogen" ? "#C0392B" : list.role === "flora" ? "#2E8B57" : "#8C8C8C");
}

function ListChip({ list }: { list: CurationListSummary }) {
  const color = listColor(list);
  const text = list.tier ? `${list.site ? `${list.site} ` : ""}${list.tier}` : list.label;
  return (
    <span className="whitespace-nowrap rounded-full px-1.5 text-xs" style={{ background: `${color}22`, color }} title={list.label}>
      {text}
    </span>
  );
}

/**
 * Which organisms of the scope's curation lists occur in the table, how often,
 * in whom and where, and how abundant they get. Computed in the browser from the
 * whole table, so the page filters apply. Any long profile with sample, taxon
 * and count roles works; group and subject roles add columns.
 */
export function CuratedOrganismsView({
  table,
  scope,
  role = "pathogen",
  lists,
  limit = 25,
  filters,
  active,
}: {
  table: ReportTable;
  scope: string;
  role?: CuratedRoleFilter;
  lists?: string[];
  limit?: number;
  filters: ReportFilter[];
  active: ActiveFilters;
}) {
  const roles = table.roles;
  const ready = Boolean(roles.sample && roles.taxon && roles.count);
  const { data: frame, error } = useTableFrame(ready ? table.datasetId : null);
  const { data: curation, error: curationError } = useCurationLists(scope);
  const rows = useMemo(() => (frame ? filteredRows(frame, filters, active) : []), [frame, filters, active]);
  const ra = useMemo(() => (roles.sample && roles.count ? relativeAbundance(rows, roles.sample, roles.count) : new Map<ExploreRowData, number>()), [rows, roles.sample, roles.count]);
  const index = useMemo(() => {
    const out = new Map<string, CurationListSummary[]>();
    for (const list of curation?.lists ?? []) {
      if (list.role === "artifact") continue;
      if (role !== "all" && list.role !== role) continue;
      if (lists && lists.length > 0 && !lists.includes(list.listId)) continue;
      for (const entry of list.entries) {
        const key = entry.name.trim().toLowerCase();
        if (!key) continue;
        const bucket = out.get(key) ?? [];
        if (!bucket.includes(list)) bucket.push(list);
        out.set(key, bucket);
      }
    }
    return out;
  }, [curation, role, lists]);

  if (!ready) return <p className="text-sm text-muted-foreground">{table.name} needs sample, taxon and count roles for organisms of interest.</p>;
  if (error || curationError) return <p className="text-sm text-destructive">Could not load the table or the curation lists.</p>;
  if (!frame || !curation) return <Skeleton className="h-40 w-full" />;

  const sampleKey = roles.sample!;
  const taxonKey = roles.taxon!;
  const groupKey = roles.group ?? null;
  const subjectKey = roles.subject ?? null;
  const allSamples = new Set<string>();
  const hits = new Map<string, CuratedHit>();
  for (const row of rows) {
    const value = ra.get(row);
    if (value === undefined) continue;
    const sample = cellText(row[sampleKey]);
    allSamples.add(sample);
    if (value <= 0) continue;
    const name = cellText(row[taxonKey]);
    const key = name.trim().toLowerCase();
    const matched = index.get(key);
    if (!matched) continue;
    const hit = hits.get(key) ?? { name, lists: matched, samples: new Set<string>(), subjects: new Set<string>(), groups: new Map<string, Set<string>>(), peak: 0, peakGroup: null };
    hit.samples.add(sample);
    if (subjectKey) hit.subjects.add(cellText(row[subjectKey]));
    const group = groupKey ? cellText(row[groupKey]) || "(none)" : null;
    if (group) {
      const set = hit.groups.get(group) ?? new Set<string>();
      set.add(sample);
      hit.groups.set(group, set);
    }
    if (value > hit.peak) {
      hit.peak = value;
      hit.peakGroup = group;
    }
    hits.set(key, hit);
  }
  const ranked = [...hits.values()].sort((a, b) => b.samples.size - a.samples.size || b.peak - a.peak || a.name.localeCompare(b.name));
  const shown = ranked.slice(0, limit);
  const roleLabel = role === "all" ? "listed" : role;
  const curationHref = `/explore/curation?scope=${encodeURIComponent(scope)}`;

  if (index.size === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This scope has no {role === "all" ? "curation" : role} lists yet.{" "}
        <Link href={curationHref} className="underline">Curated lists</Link> decide which organisms appear here.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{ranked.length}</span> of {index.size} {roleLabel} organisms occur in {allSamples.size.toLocaleString()} samples
        {ranked.length > shown.length ? `; the ${shown.length} most frequent are shown` : ""}.
      </p>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">None of the listed organisms occurs in the rows the page filters leave.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Organism</th>
                <th className="py-1 pr-3 font-medium">Lists</th>
                <th className="py-1 pr-3 text-right font-medium">Samples</th>
                {subjectKey && <th className="py-1 pr-3 text-right font-medium">Subjects</th>}
                {groupKey && <th className="py-1 pr-3 font-medium">Per {columnLabel(frame.columns, groupKey).toLowerCase()}</th>}
                <th className="py-1 text-right font-medium">Peak RA %</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((hit) => {
                const share = allSamples.size ? (100 * hit.samples.size) / allSamples.size : 0;
                return (
                  <tr key={hit.name} className="border-b align-top last:border-0">
                    <td className="py-1 pr-3 font-medium">{hit.name}</td>
                    <td className="py-1 pr-3">
                      <div className="flex flex-wrap gap-1">{hit.lists.map((list) => <ListChip key={list.listId} list={list} />)}</div>
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums">
                      <div className="flex items-center justify-end gap-2">
                        <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <span className="block h-full rounded-full bg-foreground/50" style={{ width: `${Math.max(2, share)}%` }} />
                        </span>
                        <span className="whitespace-nowrap">
                          {hit.samples.size} <span className="text-xs text-muted-foreground">({share.toFixed(0)} %)</span>
                        </span>
                      </div>
                    </td>
                    {subjectKey && <td className="py-1 pr-3 text-right tabular-nums">{hit.subjects.size}</td>}
                    {groupKey && (
                      <td className="py-1 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {[...hit.groups.entries()]
                            .sort((a, b) => b[1].size - a[1].size)
                            .map(([group, samples]) => (
                              <span key={group} className="whitespace-nowrap rounded-full border px-1.5 text-xs">
                                {group} <span className="text-muted-foreground">{samples.size}</span>
                              </span>
                            ))}
                        </div>
                      </td>
                    )}
                    <td className="whitespace-nowrap py-1 text-right tabular-nums">
                      {hit.peak.toFixed(hit.peak >= 10 ? 0 : 2)}
                      {hit.peakGroup && groupKey ? <span className="ml-1 text-xs text-muted-foreground">{hit.peakGroup}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        {table.name}
        {frame.truncated ? `, first ${frame.rows.length.toLocaleString()} of ${frame.total.toLocaleString()} rows` : ""}
        {filtersApply(table, filters, active) ? ", page filters applied" : ""}.{" "}
        <Link href={curationHref} className="underline">Curated lists</Link>
      </p>
    </div>
  );
}
