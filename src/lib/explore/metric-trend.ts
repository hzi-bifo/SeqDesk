/**
 * Trends for key figures: how a number an analysis records moved over its
 * completed runs. Pure, shared by the report view and the shared page.
 */
export interface MetricHistoryEntry {
  runNumber: string;
  completedAt: string | null;
  metrics: Record<string, string | number | boolean | null>;
}

export interface MetricTrend {
  /** Values over the runs that had this metric as a number, oldest first. */
  series: Array<{ runNumber: string; completedAt: string | null; value: number }>;
  /** Change from the compared run to the newest one; null with fewer than two values. */
  delta: number | null;
  /** The change as a fraction of the compared value; null when that was zero. */
  ratio: number | null;
  /** The run the delta is measured against. */
  since: { runNumber: string; completedAt: string | null } | null;
}

export type TrendMode = "none" | "previous" | "history" | "timeline";

/** The trend of one metric: against the previous run, or across the whole history. */
export function metricTrend(history: MetricHistoryEntry[] | null | undefined, key: string, mode: TrendMode): MetricTrend | null {
  if (mode === "none" || mode === "timeline" || !history || history.length === 0) return null;
  const series = history
    .filter((entry) => typeof entry.metrics[key] === "number" && Number.isFinite(entry.metrics[key] as number))
    .map((entry) => ({ runNumber: entry.runNumber, completedAt: entry.completedAt, value: entry.metrics[key] as number }));
  if (series.length < 2) return { series, delta: null, ratio: null, since: null };
  const newest = series[series.length - 1];
  const compared = mode === "previous" ? series[series.length - 2] : series[0];
  const delta = newest.value - compared.value;
  return {
    series,
    delta,
    ratio: compared.value === 0 ? null : delta / Math.abs(compared.value),
    since: { runNumber: compared.runNumber, completedAt: compared.completedAt },
  };
}

/** "3 days ago", "today", "2 weeks ago"; relative to `now` for testability. */
export function agoText(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

/** Points of a sparkline in a width x height box, oldest first; empty for fewer than two values. */
export function sparklinePoints(values: number[], width = 80, height = 24): Array<[number, number]> {
  if (values.length < 2) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  return values.map((value, index) => [Number((index * step).toFixed(2)), Number((height - ((value - min) / span) * (height - 4) - 2).toFixed(2))]);
}

/** A number with a fixed count of decimals when the author asked for one. */
export function formatWithDigits(value: number, digits: number | null | undefined, fallback: (value: number) => string): string {
  if (typeof digits !== "number" || !Number.isInteger(digits) || digits < 0 || digits > 6) return fallback(value);
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** "+12", "−0.03", "+4.5%": the delta as readers expect it. */
export function deltaText(trend: MetricTrend | null, fallback: (value: number) => string): string | null {
  if (!trend || trend.delta === null) return null;
  const sign = trend.delta > 0 ? "+" : trend.delta < 0 ? "−" : "±";
  const magnitude = fallback(Math.abs(trend.delta));
  const percentValue = trend.ratio === null ? null : Math.abs(trend.ratio * 100);
  const percent = percentValue === null ? "" : ` (${trend.ratio! > 0 ? "+" : trend.ratio! < 0 ? "−" : ""}${percentValue.toFixed(percentValue >= 10 || percentValue === 0 ? 0 : 1)}%)`;
  return `${sign}${magnitude}${percent}`;
}

/**
 * The line under a card: "−2 (−0.6%) since the previous run, today" or
 * "+56 (+19%) over 3 runs since 5 weeks ago". Readers get time, not run
 * numbers; the run number belongs in a tooltip.
 */
export function trendNote(trend: MetricTrend | null, mode: TrendMode, format: (value: number) => string, now: Date = new Date()): string | null {
  if (mode === "none" || mode === "timeline") return null;
  const delta = deltaText(trend, format);
  if (!delta || !trend) return "no earlier run to compare";
  const when = agoText(trend.since?.completedAt, now);
  if (mode === "previous") return `${delta} since the previous run${when ? `, ${when}` : ""}`;
  const runs = trend.series.length;
  return `${delta} over ${runs} runs${when ? ` since ${when}` : ""}`;
}
