/** Small, deterministic chart defaults. No pipeline IDs, conversions or analysis execution. */
import type { ChartKind } from "./report-blocks";
import { chartColumnLabel, type ChartSpec } from "./report-widgets";
import type { ExploreColumn, ExploreRowData } from "./types";

export interface ChartSuggestion {
  id: ChartKind;
  label: string;
  description: string;
  title: string;
  spec: ChartSpec;
}

const IDENTITY_ROLES = new Set(["sample", "subject", "taxon", "taxon_id", "rank", "group", "date", "timepoint"]);

function number(value: ExploreRowData[string]): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function present(value: ExploreRowData[string]): boolean {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function distinct(rows: ExploreRowData[], column: ExploreColumn): number {
  return new Set(rows.filter(row => present(row[column.key])).map(row => String(row[column.key]))).size;
}

function uniqueLabels(rows: ExploreRowData[], label: ExploreColumn, color?: ExploreColumn): boolean {
  const usable = rows.filter(row => present(row[label.key]));
  return usable.length > 0 && new Set(usable.map(row => JSON.stringify([String(row[label.key]), color ? row[color.key] ?? null : null]))).size === usable.length;
}

/** A caption from the actual selected columns, also used after manual adjustments. */
export function suggestedChartTitle(columns: ExploreColumn[], spec: ChartSpec): string {
  const label = (key?: string) => columns.find(column => column.key === key);
  const x = label(spec.x);
  const y = label(spec.y);
  const name = (column?: ExploreColumn) => column ? chartColumnLabel(column) : "Measurement";
  const text = spec.chart === "histogram" ? `Distribution of ${name(x)}`
    : spec.chart === "bar" ? `Rows by ${x?.label ?? "category"}`
      : spec.chart === "scatter" ? `${name(y)} vs ${name(x)}`
        : `${name(y)} by ${x?.label ?? "category"}`;
  return text.slice(0, 500);
}

/** Inspect only the bounded preview. Suggestions never aggregate or silently replace missing values. */
export function suggestCharts(columns: ExploreColumn[], rows: ExploreRowData[]): ChartSuggestion[] {
  if (!rows.length) return [];
  const numericColumns = columns.filter(column => column.type === "number" && column.group !== "identity"
    && !IDENTITY_ROLES.has(column.role ?? "") && !column.key.endsWith("_db_id"));
  const measurements = numericColumns.filter(column => rows.some(row => number(row[column.key]) !== null))
    .sort((a, b) => score(b) - score(a));
  const labels = columns.filter(column => column.type !== "number" && column.type !== "json"
    && !column.key.endsWith("_db_id") && (column.group !== "identity" || column.key === "sample_id" || column.role === "sample")
    && distinct(rows, column) > 0)
    .sort((a, b) => labelScore(b) - labelScore(a)).slice(0, 12);
  const measurement = measurements[0];
  const suggestions: ChartSuggestion[] = [];
  const add = (label: string, description: string, spec: ChartSpec) => {
    suggestions.push({ id: spec.chart, label, description, title: suggestedChartTitle(columns, spec), spec });
  };

  if (!measurement) {
    if (numericColumns.length) return []; // Unavailable measurements are not category counts.
    // Counts describe table rows, not reads or independent biological samples.
    const category = labels.find(column => column.role === "group" && distinct(rows, column) <= 12)
      ?? labels.find(column => distinct(rows, column) < rows.length && distinct(rows, column) <= 12);
    if (category) add("Count categories", "Count table rows in each category.", { chart: "bar", x: category.key });
    return suggestions;
  }

  const values = rows.filter(row => number(row[measurement.key]) !== null);
  const groups = labels.filter(column => distinct(values, column) >= 2 && distinct(values, column) <= 12)
    .sort((a, b) => Number(b.role === "group") - Number(a.role === "group"));
  // Prefer a sample/category identity. Split repeated labels only when a real
  // column distinguishes them; never sum mates, visits or duplicate samples.
  for (const label of labels) {
    const color = uniqueLabels(values, label) ? undefined : groups.find(column => column.key !== label.key && uniqueLabels(values, label, column));
    if (!uniqueLabels(values, label, color)) continue;
    add("Compare values", color ? `Show each value separately, coloured by ${color.label}.` : "Show saved values without adding them together.",
      { chart: "values", x: label.key, y: measurement.key, ...(color ? { color: color.key } : {}) });
    break;
  }

  const group = groups.find(column => {
    const counts = new Map<string, number>();
    for (const row of values) if (present(row[column.key])) {
      const key = String(row[column.key]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.values()].every(count => count >= 2);
  });
  if (group) add("Compare groups", "Compare the spread of table-row measurements within each group.", { chart: "box", x: group.key, y: measurement.key });

  const partner = [...measurements.slice(1)].sort((a, b) => Number(Boolean(b.unit && b.unit === measurement.unit)) - Number(Boolean(a.unit && a.unit === measurement.unit)))
    .find(column => values.filter(row => number(row[column.key]) !== null).length >= 2);
  if (partner) add("Compare measurements", "Plot two measurements for each row; each axis keeps its own units.", { chart: "scatter", x: measurement.key, y: partner.key });

  if (values.length >= 2 && suggestions.length < 3) add("See distribution", "See how this measurement varies across table rows.", { chart: "histogram", x: measurement.key });
  return suggestions.slice(0, 3);
}

function score(column: ExploreColumn): number {
  return (column.role === "value" ? 100 : column.role === "count" ? 50 : 0) + (column.unit ? 10 : 0);
}

function labelScore(column: ExploreColumn): number {
  return column.role === "sample" || column.key === "sample_id" ? 100
    : column.role === "taxon" ? 80 : column.role === "subject" ? 70 : column.role === "group" ? 60 : 0;
}
