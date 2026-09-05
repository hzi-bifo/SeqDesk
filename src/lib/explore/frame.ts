/**
 * Row-level operations the report runs in the browser: page filters, distinct
 * values, and small aggregations over a table's rows. Kept behind plain
 * functions so a heavier engine (DuckDB-WASM) can replace the internals later
 * without touching the blocks.
 */
import type { ExploreRowData } from "./types";

export type Cell = ExploreRowData[string];

/** The values a reader picked for a page filter, keyed by filter id; empty means "all". */
export type ActiveFilters = Record<string, string[]>;

export interface FilterDefinition {
  id: string;
  datasetId: string;
  column: string;
}

export function cellText(value: Cell): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/** Keep the rows matching every active filter whose column the table has. */
export function applyFilters(rows: ExploreRowData[], columns: Set<string>, filters: FilterDefinition[], active: ActiveFilters): ExploreRowData[] {
  const applicable = filters.filter((filter) => columns.has(filter.column) && (active[filter.id]?.length ?? 0) > 0);
  if (applicable.length === 0) return rows;
  const wanted = applicable.map((filter) => [filter.column, new Set(active[filter.id])] as const);
  return rows.filter((row) => wanted.every(([column, values]) => values.has(cellText(row[column]))));
}

/** Distinct values of a column with their counts, most frequent first, missing shown as "(missing)". */
export function distinctValues(rows: ExploreRowData[], column: string, limit = 200): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = cellText(row[column]) || "(missing)";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit);
}

export function toNumber(value: Cell): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Sum of a numeric column per value of a key column. */
export function sumBy(rows: ExploreRowData[], key: string, value: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const amount = toNumber(row[value]);
    if (amount === null) continue;
    const group = cellText(row[key]);
    totals.set(group, (totals.get(group) ?? 0) + amount);
  }
  return totals;
}

/** Group rows by the text of a column, keeping the first-seen order. */
export function groupBy(rows: ExploreRowData[], key: string): Map<string, ExploreRowData[]> {
  const groups = new Map<string, ExploreRowData[]>();
  for (const row of rows) {
    const group = cellText(row[key]);
    const list = groups.get(group) ?? [];
    list.push(row);
    groups.set(group, list);
  }
  return groups;
}

/**
 * Relative abundance per sample from a long profile: count over the sample's
 * total, in percent. Rows without a positive count are dropped.
 */
export function relativeAbundance(rows: ExploreRowData[], sampleKey: string, countKey: string): Map<ExploreRowData, number> {
  const totals = sumBy(rows, sampleKey, countKey);
  const result = new Map<ExploreRowData, number>();
  for (const row of rows) {
    const count = toNumber(row[countKey]);
    if (count === null || count <= 0) continue;
    const total = totals.get(cellText(row[sampleKey])) ?? 0;
    if (total > 0) result.set(row, (100 * count) / total);
  }
  return result;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
