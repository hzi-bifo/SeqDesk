import crypto from "crypto";
import type {
  ExploreCell,
  ExploreColumn,
  ExploreColumnType,
  ExploreRole,
  ExploreRoleMap,
  ExploreRowData,
  ExploreSchema,
} from "./types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function normalizeColumnKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "column";
  return trimmed
    .replace(/[^\p{L}\p{N}_%. -]+/gu, " ")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

export function coerceCell(value: unknown): ExploreCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "bigint") return Number(value);
  return JSON.stringify(value);
}

function detectType(values: ExploreCell[]): ExploreColumnType {
  let numbers = 0;
  let booleans = 0;
  let dates = 0;
  let strings = 0;
  for (const value of values) {
    if (value === null) continue;
    if (typeof value === "number") {
      numbers += 1;
    } else if (typeof value === "boolean") {
      booleans += 1;
    } else if (typeof value === "string") {
      const lower = value.toLowerCase();
      if (lower === "true" || lower === "false") {
        booleans += 1;
      } else if (value !== "" && !Number.isNaN(Number(value)) && /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(value)) {
        numbers += 1;
      } else if (DATE_PATTERN.test(value)) {
        dates += 1;
      } else {
        strings += 1;
      }
    }
  }
  const total = numbers + booleans + dates + strings;
  if (total === 0) return "string";
  if (numbers === total) return "number";
  if (booleans === total) return "boolean";
  if (dates === total) return "date";
  return "string";
}

/**
 * Infer a schema from row objects. Column order follows first appearance so a
 * builder can control it by emitting rows with a stable key order.
 */
export function inferSchema(
  rows: ExploreRowData[],
  options: { labels?: Record<string, string>; roles?: ExploreRoleMap; groups?: Record<string, string> } = {}
): ExploreSchema {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  const roleByColumn = new Map<string, ExploreRole>();
  for (const [role, column] of Object.entries(options.roles ?? {})) {
    if (column) roleByColumn.set(column, role as ExploreRole);
  }
  const columns: ExploreColumn[] = keys.map((key) => ({
    key,
    label: options.labels?.[key] ?? key,
    type: detectType(rows.map((row) => row[key] ?? null)),
    role: roleByColumn.get(key),
    group: options.groups?.[key],
  }));
  return { columns };
}

/**
 * Cast the cells of every row to the declared column types so stored rows are
 * consistent regardless of the source parser.
 */
export function castRowsToSchema(rows: ExploreRowData[], schema: ExploreSchema): ExploreRowData[] {
  const types = new Map(schema.columns.map((column) => [column.key, column.type] as const));
  return rows.map((row) => {
    const out: ExploreRowData = {};
    for (const column of schema.columns) {
      out[column.key] = castCell(row[column.key] ?? null, types.get(column.key) ?? "string");
    }
    return out;
  });
}

export function castCell(value: ExploreCell, type: ExploreColumnType): ExploreCell {
  if (value === null) return null;
  switch (type) {
    case "number": {
      if (typeof value === "number") return value;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      const lower = String(value).toLowerCase();
      if (lower === "true" || lower === "1" || lower === "yes") return true;
      if (lower === "false" || lower === "0" || lower === "no") return false;
      return null;
    }
    case "date":
    case "string":
    case "json":
    default:
      return typeof value === "string" ? value : String(value);
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}

/**
 * Content hash of a dataset version. Independent of row order and of column
 * order: each row is hashed on its sorted keys and the row hashes are sorted
 * before the final digest. Two builds of the same data give the same hash even
 * when a source returned rows in a different order.
 */
export function computeContentHash(schema: ExploreSchema, rows: ExploreRowData[]): string {
  const rowHashes = rows
    .map((row) => crypto.createHash("sha256").update(stableStringify(row)).digest("hex"))
    .sort();
  const columnSignature = schema.columns
    .map((column) => `${column.key}:${column.type}`)
    .sort()
    .join("|");
  const digest = crypto.createHash("sha256");
  digest.update(columnSignature);
  digest.update("\n");
  for (const hash of rowHashes) digest.update(hash);
  return digest.digest("hex");
}

export function parseSchema(raw: string | null | undefined): ExploreSchema {
  if (!raw) return { columns: [] };
  try {
    const parsed = JSON.parse(raw) as ExploreSchema;
    return Array.isArray(parsed?.columns) ? parsed : { columns: [] };
  } catch {
    return { columns: [] };
  }
}

export function parseRoles(raw: string | null | undefined): ExploreRoleMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as ExploreRoleMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
