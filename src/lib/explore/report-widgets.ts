/**
 * Charts and summary numbers a report draws straight from a table. Pure
 * functions over rows, client-safe, so the report page can render them from
 * the rows API and the tests can check them without a browser.
 */
import type { ChartKind, MetricStat } from "./report-blocks";
import type { ExploreColumn, ExploreRowData } from "./types";

type Cell = ExploreRowData[string];

/** Rows the report reads at most for a chart or a number block; more is noted, not drawn. */
export const WIDGET_ROW_LIMIT = 2000;
const MAX_CATEGORIES = 30;
const MAX_GROUPS = 12;

function isMissing(value: Cell): boolean {
  return value === null || value === undefined || value === "";
}

function toNumber(value: Cell): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** The finite numbers in one column, in row order. */
export function numericValues(rows: ExploreRowData[], key: string): number[] {
  const values: number[] = [];
  for (const row of rows) {
    const parsed = toNumber(row[key]);
    if (parsed !== null) values.push(parsed);
  }
  return values;
}

function quantile(sorted: number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/** Every supported summary of one column; non-numeric columns get null for the arithmetic ones. */
export function computeStats(rows: ExploreRowData[], key: string): Record<MetricStat, number | null> {
  const present = rows.filter((row) => !isMissing(row[key]));
  const numbers = numericValues(rows, key);
  const sorted = [...numbers].sort((a, b) => a - b);
  const numeric = numbers.length > 0 && numbers.length === present.length;
  const sum = numbers.reduce((total, value) => total + value, 0);
  return {
    count: rows.length,
    distinct: new Set(present.map((row) => String(row[key]))).size,
    missing: rows.length - present.length,
    mean: numeric ? sum / numbers.length : null,
    median: numeric ? quantile(sorted, 0.5) : null,
    min: numeric ? sorted[0] : null,
    max: numeric ? sorted[sorted.length - 1] : null,
    sum: numeric ? sum : null,
  };
}

/** Numbers for people: integers as they are, others with a few significant digits, thousands separated. */
export function formatStat(value: number | null): string {
  if (value === null) return "n/a";
  if (Number.isInteger(value)) return value.toLocaleString();
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 1 : abs >= 1 ? 2 : 4;
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export interface ChartSpec {
  chart: ChartKind;
  x: string;
  y?: string;
  color?: string;
}

export interface ChartResult {
  data: Array<Record<string, unknown>>;
  layout: Record<string, unknown>;
  /** Something the reader should know: a column was not numeric, groups were capped, rows were cut. */
  notes: string[];
}

function labelOf(columns: ExploreColumn[], key: string): string {
  return columns.find((column) => column.key === key)?.label ?? key;
}

function groupsOf(rows: ExploreRowData[], key: string | undefined): Map<string, ExploreRowData[]> {
  const groups = new Map<string, ExploreRowData[]>();
  for (const row of rows) {
    const value = key ? (isMissing(row[key]) ? "(missing)" : String(row[key])) : "";
    const list = groups.get(value) ?? [];
    list.push(row);
    groups.set(value, list);
  }
  return groups;
}

function countsOf(rows: ExploreRowData[], key: string): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = isMissing(row[key]) ? "(missing)" : String(row[key]);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * Plotly traces and layout for one chart block. Histograms of text columns fall
 * back to bar counts, group colours cap at a dozen, and category axes at thirty.
 */
export function buildChart(rows: ExploreRowData[], columns: ExploreColumn[], spec: ChartSpec, totalRows?: number): ChartResult {
  const notes: string[] = [];
  if (typeof totalRows === "number" && totalRows > rows.length) notes.push(`Drawn from the first ${rows.length.toLocaleString()} of ${totalRows.toLocaleString()} rows.`);
  const xLabel = labelOf(columns, spec.x);
  const base = { margin: { l: 48, r: 16, t: 16, b: 48 }, legend: { orientation: "h" as const, y: -0.25 } };
  const xNumeric = numericValues(rows, spec.x).length > 0 && numericValues(rows, spec.x).length === rows.filter((row) => !isMissing(row[spec.x])).length;

  if (spec.chart === "histogram" && xNumeric) {
    const groups = spec.color ? groupsOf(rows, spec.color) : new Map([["", rows]]);
    const entries = [...groups.entries()].slice(0, MAX_GROUPS);
    if (groups.size > MAX_GROUPS) notes.push(`Only the first ${MAX_GROUPS} groups of ${labelOf(columns, spec.color!)} are coloured.`);
    return {
      data: entries.map(([name, group]) => ({ type: "histogram", x: numericValues(group, spec.x), name: name || xLabel, opacity: entries.length > 1 ? 0.6 : 1 })),
      layout: { ...base, barmode: "overlay", xaxis: { title: { text: xLabel } }, yaxis: { title: { text: "Rows" } }, showlegend: entries.length > 1 },
      notes,
    };
  }

  if (spec.chart === "histogram" || spec.chart === "bar") {
    if (spec.chart === "histogram") notes.push(`${xLabel} is not numeric, so the chart counts its values instead.`);
    const counts = countsOf(rows, spec.x);
    const shown = counts.slice(0, MAX_CATEGORIES);
    if (counts.length > MAX_CATEGORIES) notes.push(`Only the ${MAX_CATEGORIES} most frequent values of ${xLabel} are shown.`);
    const categories = shown.map(([value]) => value);
    if (spec.color) {
      const groups = [...groupsOf(rows, spec.color).entries()].slice(0, MAX_GROUPS);
      return {
        data: groups.map(([name, group]) => {
          const inner = new Map(countsOf(group, spec.x));
          return { type: "bar", name, x: categories, y: categories.map((category) => inner.get(category) ?? 0) };
        }),
        layout: { ...base, barmode: "stack", xaxis: { title: { text: xLabel }, type: "category" }, yaxis: { title: { text: "Rows" } } },
        notes,
      };
    }
    return {
      data: [{ type: "bar", x: categories, y: shown.map(([, count]) => count), name: xLabel }],
      layout: { ...base, xaxis: { title: { text: xLabel }, type: "category" }, yaxis: { title: { text: "Rows" } }, showlegend: false },
      notes,
    };
  }

  if (spec.chart === "scatter") {
    if (!spec.y) return { data: [], layout: base, notes: ["Choose a second column for the y axis."] };
    const yLabel = labelOf(columns, spec.y);
    const groups = spec.color ? [...groupsOf(rows, spec.color).entries()] : [["", rows] as [string, ExploreRowData[]]];
    if (groups.length > MAX_GROUPS) notes.push(`Only the first ${MAX_GROUPS} groups of ${labelOf(columns, spec.color!)} are coloured.`);
    const data = groups.slice(0, MAX_GROUPS).map(([name, group]) => {
      const x: number[] = [];
      const y: number[] = [];
      for (const row of group) {
        const xValue = toNumber(row[spec.x]);
        const yValue = toNumber(row[spec.y!]);
        if (xValue !== null && yValue !== null) {
          x.push(xValue);
          y.push(yValue);
        }
      }
      return { type: "scatter", mode: "markers", name: name || `${yLabel} by ${xLabel}`, x, y, marker: { size: 7, opacity: 0.75 } };
    });
    return { data, layout: { ...base, xaxis: { title: { text: xLabel } }, yaxis: { title: { text: yLabel } }, showlegend: groups.length > 1 }, notes };
  }

  // Box plot: the y column summarised per value of x.
  if (!spec.y) return { data: [], layout: base, notes: ["Choose the numeric column to summarise."] };
  const yLabel = labelOf(columns, spec.y);
  const groups = [...groupsOf(rows, spec.x).entries()];
  if (groups.length > MAX_CATEGORIES) notes.push(`Only the first ${MAX_CATEGORIES} groups of ${xLabel} are shown.`);
  return {
    data: groups.slice(0, MAX_CATEGORIES).map(([name, group]) => ({ type: "box", name, y: numericValues(group, spec.y!), boxpoints: "outliers" })),
    layout: { ...base, xaxis: { title: { text: xLabel }, type: "category" }, yaxis: { title: { text: yLabel } }, showlegend: false },
    notes,
  };
}

/** Columns a chart can put on a numeric axis. */
export function numericColumns(columns: ExploreColumn[]): ExploreColumn[] {
  return columns.filter((column) => column.type === "number");
}
