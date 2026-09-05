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
export function formatNumber(value: number): string {
  if (!Number.isFinite(value) || Number.isInteger(value)) return String(value);
  const magnitude = Math.abs(value);
  if (magnitude >= 1) {
    const integerDigits = Math.floor(Math.log10(magnitude)) + 1;
    const fractionDigits = Math.max(0, 6 - integerDigits);
    return String(Number(value.toFixed(fractionDigits)));
  }
  return String(Number(value.toPrecision(6)));
}

export function formatCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return value;
}
