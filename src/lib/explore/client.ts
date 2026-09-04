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

export function formatCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toPrecision(6).replace(/\.?0+$/, "");
  if (typeof value === "boolean") return value ? "true" : "false";
  return value;
}
