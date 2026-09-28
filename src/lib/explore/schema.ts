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
import type { TableContract } from "./table-contract";

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

type TypeCounts = { numbers: number; booleans: number; dates: number; strings: number };

function countType(counts: TypeCounts, value: ExploreCell) {
  if (value === null) return;
  if (typeof value === "number") {
    counts.numbers += 1;
  } else if (typeof value === "boolean") {
    counts.booleans += 1;
  } else if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true" || lower === "false") {
      counts.booleans += 1;
    } else if (value !== "" && !Number.isNaN(Number(value)) && /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(value)) {
      counts.numbers += 1;
    } else if (DATE_PATTERN.test(value)) {
      counts.dates += 1;
    } else {
      counts.strings += 1;
    }
  }
}

function typeOfCounts({ numbers, booleans, dates, strings }: TypeCounts): ExploreColumnType {
  const total = numbers + booleans + dates + strings;
  if (total === 0) return "string";
  if (numbers === total) return "number";
  if (booleans === total) return "boolean";
  if (dates === total) return "date";
  return "string";
}

function detectType(values: ExploreCell[]): ExploreColumnType {
  const counts: TypeCounts = { numbers: 0, booleans: 0, dates: 0, strings: 0 };
  for (const value of values) countType(counts, value);
  return typeOfCounts(counts);
}

/**
 * inferSchema one row at a time: the same column order (first appearance) and the same type rules, with
 * memory per column instead of per cell, for imports that stream.
 */
export class SchemaAccumulator {
  private keys: string[] = [];
  private counts = new Map<string, TypeCounts>();
  add(row: ExploreRowData) {
    for (const key in row) {
      let counts = this.counts.get(key);
      if (!counts) {
        counts = { numbers: 0, booleans: 0, dates: 0, strings: 0 };
        this.counts.set(key, counts);
        this.keys.push(key);
      }
      countType(counts, row[key] ?? null);
    }
  }
  schema(options: { labels?: Record<string, string>; roles?: ExploreRoleMap; groups?: Record<string, string> } = {}): ExploreSchema {
    const roleByColumn = new Map<string, ExploreRole>();
    for (const [role, column] of Object.entries(options.roles ?? {})) {
      if (column) roleByColumn.set(column, role as ExploreRole);
    }
    return { columns: this.keys.map((key) => ({
      key,
      label: options.labels?.[key] ?? key,
      type: typeOfCounts(this.counts.get(key)!),
      role: roleByColumn.get(key),
      group: options.groups?.[key],
    })) };
  }
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
  // Metadata changes can change scientific meaning even when values are identical.
  // Retain legacy hashes for legacy schemas, but version declared units/contracts.
  if (schema.schemaId || schema.schemaVersion || schema.rowEntity || schema.columns.some(column => column.unit || column.nullable !== undefined)) {
    digest.update(stableStringify({ schemaId: schema.schemaId, schemaVersion: schema.schemaVersion, rowEntity: schema.rowEntity,
      columns: schema.columns.map(({ key, unit, nullable }) => ({ key, unit, nullable })).sort((a, b) => a.key.localeCompare(b.key)) }));
  }
  digest.update("\n");
  for (const hash of rowHashes) digest.update(hash);
  return digest.digest("hex");
}

/** Validate actual cells before attaching package metadata; never silently turn bad values into null. */
export function applyTableContract(schema: ExploreSchema, rows: ExploreRowData[], contract: TableContract, protectedKeys: string[] = []): ExploreSchema {
  const protectedSet = new Set(protectedKeys);
  const actual = new Map(schema.columns.map(column => [column.key, column]));
  for (const [key, declaration] of Object.entries(contract.columns ?? {})) {
    if (protectedSet.has(key)) continue;
    const column = actual.get(key);
    if (!column) {
      if (declaration.required) throw new Error(`Required column "${key}" is missing.`);
      continue;
    }
    for (const row of rows) {
      const value = row[key] ?? null;
      if (value === null) {
        if (declaration.nullable === false) throw new Error(`Column "${key}" contains a missing value.`);
        continue;
      }
      const numeric = typeof value === "number" || (typeof value === "string" && /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(value));
      const valid = declaration.type === "number" ? numeric && Number.isFinite(Number(value))
        : declaration.type === "boolean" ? typeof value === "boolean" || /^(true|false|1|0)$/i.test(String(value))
        : declaration.type === "date" ? DATE_PATTERN.test(String(value)) && Number.isFinite(Date.parse(String(value)))
        : declaration.type === "json" ? (() => { try { JSON.parse(String(value)); return true; } catch { return false; } })()
        : true;
      if (!valid) throw new Error(`Column "${key}" must contain ${declaration.type} values.`);
    }
    Object.assign(column, { type: declaration.type, label: declaration.label ?? column.label,
      description: declaration.description ?? column.description, unit: declaration.unit, nullable: declaration.nullable });
  }
  return { ...schema, schemaId: contract.schemaId, schemaVersion: contract.schemaVersion, rowEntity: contract.rowEntity };
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

/** Row hashes kept for the exact (sorted) content hash up to this many rows; beyond it a multiset sum is used. */
export const EXACT_HASH_MAX_ROWS = 1_000_000;

/**
 * computeContentHash one row at a time. Up to EXACT_HASH_MAX_ROWS rows the result is identical to
 * computeContentHash (sorted row hashes); above that, keeping every row hash would cost more memory than the
 * rows are worth, so the rows are combined as a sum of their hashes (still independent of row order, and still
 * changing with any value). Such hashes carry the prefix "m1-".
 */
export class ContentHashAccumulator {
  private hashes: string[] | null = [];
  private lanes = [BigInt(0), BigInt(0), BigInt(0), BigInt(0)];
  private rows = 0;
  constructor(private exactMaxRows = EXACT_HASH_MAX_ROWS) {}
  add(row: ExploreRowData) {
    const digest = crypto.createHash("sha256").update(stableStringify(row)).digest();
    this.rows += 1;
    if (this.hashes) {
      this.hashes.push(digest.toString("hex"));
      if (this.hashes.length > this.exactMaxRows) this.hashes = null;
    }
    for (let lane = 0; lane < 4; lane += 1) this.lanes[lane] = BigInt.asUintN(64, this.lanes[lane] + digest.readBigUInt64BE(lane * 8));
  }
  digest(schema: ExploreSchema): string {
    const digest = crypto.createHash("sha256");
    digest.update(columnSignatureOf(schema));
    if (this.hashes) {
      digest.update("\n");
      for (const hash of this.hashes.sort()) digest.update(hash);
      return digest.digest("hex");
    }
    digest.update(`\nm1:${this.rows}:`);
    for (const lane of this.lanes) digest.update(lane.toString(16).padStart(16, "0"));
    return `m1-${digest.digest("hex")}`;
  }
}

function columnSignatureOf(schema: ExploreSchema): string {
  let text = schema.columns.map((column) => `${column.key}:${column.type}`).sort().join("|");
  if (schema.schemaId || schema.schemaVersion || schema.rowEntity || schema.columns.some(column => column.unit || column.nullable !== undefined)) {
    text += stableStringify({ schemaId: schema.schemaId, schemaVersion: schema.schemaVersion, rowEntity: schema.rowEntity,
      columns: schema.columns.map(({ key, unit, nullable }) => ({ key, unit, nullable })).sort((a, b) => a.key.localeCompare(b.key)) });
  }
  return text;
}
