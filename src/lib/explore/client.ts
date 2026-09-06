/**
 * Client-side helpers for the Explore pages. No server imports here.
 */
import type { ExploreRole } from "./types";

export const fetcher = async (url: string) => {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error || `Request failed (${response.status})`);
  }
  return payload;
};

export async function postJson<T = unknown>(url: string, body?: unknown, method: "POST" | "PUT" | "PATCH" | "DELETE" = "POST"): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error || `Request failed (${response.status})`);
  }
  return payload as T;
}

export const ROLE_LABELS: Record<ExploreRole, string> = {
  sample: "Sample",
  subject: "Subject",
  timepoint: "Timepoint",
  group: "Group",
  taxon: "Taxon",
  taxon_id: "Taxon ID",
  rank: "Rank",
  value: "Value",
  count: "Count",
  date: "Date",
};

export const SCOPE_STORAGE_KEY = "seqdesk:explore:scope";

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

/**
 * Up to six significant digits, but never rounding away the integer part of a
 * large value (a read count must stay exact); integers print verbatim. The same
 * rule the DataGrid applies, so a value reads alike on a card and in the table.
 */
/**
 * Numbers for reading, not for computing: millions and more compact (48.9M),
 * thousands with separators and no decimals, everyday values with two
 * decimals, small values (p-values, fractions) with three significant digits.
 * The exact value belongs in a tooltip next to it.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000) return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  if (magnitude >= 1000) return Math.round(value).toLocaleString("en-US");
  if (magnitude >= 1) return Number(value.toFixed(2)).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return String(Number(value.toPrecision(3)));
}

type CellValue = string | number | boolean | null | undefined;

/** A number, also when a number-typed column stores it as text; otherwise nothing. */
function numericValue(value: CellValue, type?: string): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (type === "number" && typeof value === "string") {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    return trimmed !== "" && Number.isFinite(numeric) ? numeric : undefined;
  }
  return undefined;
}

/** The unrounded value for a tooltip, or nothing when the shown text already is exact. */
export function exactValue(value: CellValue, type?: string): string | undefined {
  const numeric = numericValue(value, type);
  if (numeric === undefined) return undefined;
  const exact = String(numeric);
  return exact === formatNumber(numeric) ? undefined : exact;
}

/** Text for one table cell. Numbers are rounded for reading, also when a number column stores them as text. */
export function formatCell(value: CellValue, type?: string): string {
  if (value === null || value === undefined) return "";
  const numeric = numericValue(value, type);
  if (numeric !== undefined) return formatNumber(numeric);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return value;
}
