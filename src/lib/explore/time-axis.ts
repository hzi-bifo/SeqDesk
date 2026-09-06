/**
 * Time in a table: a calendar date column or a study-day column. Found from
 * what the table already knows (its roles), then column types, then names,
 * so the answer is stable across runs. Pure; shared by the report view,
 * the shared page and the timeline API.
 */
import type { ReportAnalysis, ReportTable } from "./reports";
import type { ExploreColumn, ExploreRoleMap, ExploreRowData } from "./types";

export type TimeAxisKind = "date" | "day";

export interface TimeAxis {
  column: string;
  kind: TimeAxisKind;
  /** "collection date" or "study day", for captions. */
  label: string;
}

const DAY_NAMES = ["timepoint", "day", "study_day", "studyday", "rel_day", "relday", "relative_day", "collection_day", "visit"];
const DATE_NAMES = ["date", "collection_date", "sampling_date", "sample_date", "collected", "collected_at", "sampled_at"];

function norm(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

export function detectTimeAxis(columns: ExploreColumn[], roles: ExploreRoleMap): TimeAxis | null {
  const byKey = new Map(columns.map((column) => [column.key, column] as const));
  if (roles.date && byKey.has(roles.date)) return { column: roles.date, kind: "date", label: "date" };
  if (roles.timepoint && byKey.get(roles.timepoint)?.type === "number") return { column: roles.timepoint, kind: "day", label: "study day" };
  const dated = columns.find((column) => column.type === "date");
  if (dated) return { column: dated.key, kind: "date", label: "date" };
  const dayNamed = columns.find((column) => column.type === "number" && DAY_NAMES.includes(norm(column.key)));
  if (dayNamed) return { column: dayNamed.key, kind: "day", label: "study day" };
  const dateNamed = columns.find((column) => column.type === "string" && DATE_NAMES.includes(norm(column.key)));
  if (dateNamed) return { column: dateNamed.key, kind: "date", label: "date" };
  return null;
}

export type TimelineMeasure = { kind: "distinct" | "sum" | "mean" | "median" | "min" | "max"; column: string } | { kind: "count" };

/** Measures that add up over time; the others are computed per bucket. */
export function isCumulative(measure: TimelineMeasure): boolean {
  return measure.kind === "distinct" || measure.kind === "sum" || measure.kind === "count";
}

/** What a key figure named like n_subjects or total_reads counts in the table, when the roles say so. */
export function suggestMeasure(key: string, roles: ExploreRoleMap): TimelineMeasure | null {
  const name = norm(key);
  const distinct = (role: keyof ExploreRoleMap): TimelineMeasure | null => (roles[role] ? { kind: "distinct", column: roles[role] as string } : null);
  if (/^(n_)?(subjects?|patients?)$/.test(name)) return distinct("subject");
  if (/^(n_)?samples?$/.test(name)) return distinct("sample");
  if (/^(n_)?(taxa|taxons?|species)$/.test(name)) return distinct("taxon");
  if (/^(total_|n_|sum_)?reads$/.test(name)) return roles.count ? { kind: "sum", column: roles.count } : null;
  if (/^(n_)?rows$/.test(name)) return { kind: "count" };
  return null;
}

export function parseMeasure(text: string | null | undefined): TimelineMeasure | null {
  if (!text) return null;
  if (text === "count") return { kind: "count" };
  const match = text.match(/^(distinct|sum|mean|median|min|max):(.+)$/);
  if (!match) return null;
  return { kind: match[1] as "distinct" | "sum" | "mean" | "median" | "min" | "max", column: match[2] };
}

export function measureText(measure: TimelineMeasure): string {
  return measure.kind === "count" ? "count" : `${measure.kind}:${measure.column}`;
}

/** The time value of a row on the axis: a day number, or milliseconds since the epoch. */
export function timeValue(row: ExploreRowData, axis: TimeAxis): number | null {
  const raw = row[axis.column];
  if (raw === null || raw === undefined || raw === "") return null;
  if (axis.kind === "day") {
    const value = typeof raw === "number" ? raw : Number(String(raw).replace(/^d/i, ""));
    return Number.isFinite(value) ? value : null;
  }
  const time = typeof raw === "number" ? raw : Date.parse(String(raw));
  return Number.isFinite(time) ? time : null;
}

export interface TimelineBucket {
  /** Start of the bucket on the axis. */
  t: number;
  /** "day 300", "2026-03", "week of 2026-03-02". */
  label: string;
  /** The measure within this bucket. */
  value: number;
  /** The measure over everything up to and including this bucket. */
  cumulative: number;
}

export interface TimelineSeries {
  axis: TimeAxis;
  measure: TimelineMeasure;
  /** Width of a bucket in days. */
  step: number;
  buckets: TimelineBucket[];
  /** The measure over the whole table. */
  total: number;
  rowsWithoutTime: number;
}

const DAY_MS = 86_400_000;
const NICE_STEPS = [1, 7, 14, 30, 90, 180, 365, 730];

/** A bucket width in days that gives roughly a dozen buckets over the span. */
export function chooseStep(spanDays: number, target = 12): number {
  if (!(spanDays > 0)) return 1;
  const raw = spanDays / target;
  return NICE_STEPS.find((step) => step >= raw) ?? Math.ceil(raw / 365) * 365;
}

/** Calendar buckets for dates: years, months, weeks (from Monday) or days. */
function calendarStart(t: number, step: number): number {
  const date = new Date(t);
  if (step >= 365) return Date.UTC(date.getUTCFullYear(), 0, 1);
  if (step >= 30) return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  if (step >= 7) return day - ((date.getUTCDay() + 6) % 7) * DAY_MS;
  return day;
}

function bucketLabel(t: number, axis: TimeAxis, step: number): string {
  if (axis.kind === "day") return `day ${t}`;
  const date = new Date(t);
  const iso = date.toISOString().slice(0, 10);
  if (step >= 365) return iso.slice(0, 4);
  if (step >= 30) return iso.slice(0, 7);
  return step >= 7 ? `week of ${iso}` : iso;
}

/**
 * Buckets of a measure along the axis. Distinct counts and sums are
 * cumulative by nature ("subjects seen so far"); the per-bucket value is
 * what the bucket added.
 */
export function buildTimeline(rows: ExploreRowData[], axis: TimeAxis, measure: TimelineMeasure, target = 12): TimelineSeries {
  const timed: Array<{ t: number; row: ExploreRowData }> = [];
  let rowsWithoutTime = 0;
  for (const row of rows) {
    const t = timeValue(row, axis);
    if (t === null) rowsWithoutTime += 1;
    else timed.push({ t, row });
  }
  timed.sort((a, b) => a.t - b.t);
  const unit = axis.kind === "day" ? 1 : DAY_MS;
  const span = timed.length > 0 ? (timed[timed.length - 1].t - timed[0].t) / unit : 0;
  const step = chooseStep(span, target);
  const width = step * unit;
  const origin = timed.length > 0 ? Math.floor(timed[0].t / width) * width : 0;
  const buckets = new Map<number, { rows: ExploreRowData[] }>();
  for (const entry of timed) {
    const start = axis.kind === "date" ? calendarStart(entry.t, step) : origin + Math.floor((entry.t - origin) / width) * width;
    const bucket = buckets.get(start) ?? { rows: [] };
    bucket.rows.push(entry.row);
    buckets.set(start, bucket);
  }
  const seen = new Set<string>();
  let running = 0;
  const result: TimelineBucket[] = [];
  for (const start of [...buckets.keys()].sort((a, b) => a - b)) {
    const bucketRows = buckets.get(start)!.rows;
    let added = 0;
    if (measure.kind === "count") added = bucketRows.length;
    else if (measure.kind === "sum" || measure.kind === "mean" || measure.kind === "median" || measure.kind === "min" || measure.kind === "max") {
      const numbers = bucketRows.map((row) => Number(row[measure.column])).filter((value) => Number.isFinite(value));
      if (measure.kind === "sum") added = numbers.reduce((total, value) => total + value, 0);
      else if (numbers.length === 0) added = Number.NaN;
      else if (measure.kind === "mean") added = numbers.reduce((total, value) => total + value, 0) / numbers.length;
      else if (measure.kind === "min") added = Math.min(...numbers);
      else if (measure.kind === "max") added = Math.max(...numbers);
      else {
        const sorted = [...numbers].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        added = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
      }
    } else {
      for (const row of bucketRows) {
        const value = row[measure.column];
        if (value === null || value === undefined || value === "") continue;
        const key = String(value);
        if (!seen.has(key)) {
          seen.add(key);
          added += 1;
        }
      }
    }
    if (Number.isNaN(added)) continue;
    // Per-bucket statistics do not accumulate: the curve shows the bucket's own value.
    running = isCumulative(measure) ? running + added : added;
    result.push({ t: start, label: bucketLabel(start, axis, step), value: added, cumulative: running });
  }
  return { axis, measure, step, buckets: result, total: running, rowsWithoutTime };
}

/** "+12 in the last 90 study days" or "+3 in the last 3 months"; null with fewer than two buckets. */
export function timelineNote(series: TimelineSeries, format: (value: number) => string): string | null {
  if (series.buckets.length < 2) return null;
  const last = series.buckets[series.buckets.length - 1];
  if (!isCumulative(series.measure)) {
    const first = series.buckets[0];
    const change = last.value - first.value;
    const sign = change > 0 ? "+" : change < 0 ? "−" : "±";
    return `${sign}${format(Math.abs(change))} from ${first.label} to ${last.label}`;
  }
  const recent = series.buckets.filter((bucket) => bucket.t > last.t - windowFor(series) * (series.axis.kind === "day" ? 1 : DAY_MS));
  const added = recent.reduce((sum, bucket) => sum + bucket.value, 0);
  const sign = added > 0 ? "+" : added < 0 ? "−" : "±";
  return `${sign}${format(Math.abs(added))} in the last ${windowText(series)}`;
}

function windowFor(series: TimelineSeries): number {
  // About a quarter of the span, rounded to whole buckets, at least one bucket.
  const span = series.buckets.length > 0 ? series.buckets[series.buckets.length - 1].t - series.buckets[0].t : 0;
  const unit = series.axis.kind === "day" ? 1 : DAY_MS;
  const quarter = Math.max(series.step, Math.round(span / unit / 4 / series.step) * series.step);
  return quarter;
}

function windowText(series: TimelineSeries): string {
  const days = windowFor(series);
  if (series.axis.kind === "day") return `${days} study days`;
  if (days >= 365) return `${Math.round(days / 365)} years`;
  if (days >= 60) return `${Math.round(days / 30)} months`;
  if (days >= 14) return `${Math.round(days / 7)} weeks`;
  return `${days} days`;
}

export interface AnalysisTimeline {
  datasetId: string;
  tableName: string;
  axis: TimeAxis;
  roles: ExploreRoleMap;
}

/** The first table an analysis reads that has a time axis, or null. */
export function analysisTimeline(analysis: ReportAnalysis | null | undefined, tables: Pick<ReportTable, "datasetId" | "name" | "columns" | "roles">[]): AnalysisTimeline | null {
  for (const input of analysis?.inputs ?? []) {
    const table = tables.find((entry) => entry.datasetId === input.datasetId);
    if (!table) continue;
    const axis = detectTimeAxis(table.columns, table.roles);
    if (axis) return { datasetId: table.datasetId, tableName: table.name, axis, roles: table.roles };
  }
  return null;
}
