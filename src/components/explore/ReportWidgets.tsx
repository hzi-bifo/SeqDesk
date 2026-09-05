"use client";

import { useMemo, useState } from "react";
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

export function RunMetricView({ analysis, metrics }: { analysis: ReportAnalysis | null; metrics: string[] }) {
  if (!analysis) return <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">This analysis is gone.</div>;
  if (!analysis.runNumber) return <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{analysis.name} has not finished a run yet.</div>;
  return (
    <div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(4, metrics.length)}, minmax(0, 1fr))` }}>
        {metrics.map((key) => {
          const value = analysis.metrics[key];
          const text = typeof value === "number" ? formatStat(value) : value === null || value === undefined ? "n/a" : formatCell(value);
          return (
            <div key={key} className="rounded-md border bg-muted/20 px-3 py-2">
              <div className="truncate text-xl font-semibold tabular-nums" title={text}>{text}</div>
              <div className="truncate text-[11px] text-muted-foreground" title={key}>{metricLabel(key)}</div>
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{analysis.name}, {analysis.runNumber}</p>
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
