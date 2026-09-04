import { db } from "@/lib/db";
import type { ExploreColumn, ExploreEditKind, ExploreEditTarget, ExploreRowRecord } from "./types";

export const EXPLORE_EDIT_KINDS: readonly ExploreEditKind[] = [
  "cell",
  "row-flag",
  "row-exclude",
  "column-add",
  "column-hide",
] as const;

export interface ExploreEditRecord {
  id: string;
  datasetId: string;
  kind: ExploreEditKind;
  target: ExploreEditTarget;
  value: unknown;
  reason: string | null;
  createdById: string;
  createdAt: string;
  revokedAt: string | null;
}

/**
 * The key a curation edit attaches to. Rows are rebuilt from their sources, so
 * rowIndex alone is not stable; sample id plus secondary key is used whenever
 * the dataset provides them, and rowIndex only as a last resort.
 */
export function rowKeyOf(row: Pick<ExploreRowRecord, "rowIndex" | "sampleId" | "key">): string {
  if (row.sampleId && row.key) return `s:${row.sampleId}|k:${row.key}`;
  if (row.sampleId) return `s:${row.sampleId}`;
  if (row.key) return `k:${row.key}`;
  return `i:${row.rowIndex}`;
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function serializeEdit(edit: {
  id: string;
  datasetId: string;
  kind: string;
  target: string;
  value: string | null;
  reason: string | null;
  createdById: string;
  createdAt: Date;
  revokedAt: Date | null;
}): ExploreEditRecord {
  const target = parseJson(edit.target);
  return {
    id: edit.id,
    datasetId: edit.datasetId,
    kind: edit.kind as ExploreEditKind,
    target: target && typeof target === "object" ? (target as ExploreEditTarget) : {},
    value: parseJson(edit.value),
    reason: edit.reason,
    createdById: edit.createdById,
    createdAt: edit.createdAt.toISOString(),
    revokedAt: edit.revokedAt ? edit.revokedAt.toISOString() : null,
  };
}

export async function listActiveEdits(datasetId: string): Promise<ExploreEditRecord[]> {
  const edits = await db.exploreDatasetEdit.findMany({
    where: { datasetId, revokedAt: null },
    orderBy: { createdAt: "asc" },
  });
  return edits.map(serializeEdit);
}

export async function listAllEdits(datasetId: string): Promise<ExploreEditRecord[]> {
  const edits = await db.exploreDatasetEdit.findMany({
    where: { datasetId },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return edits.map(serializeEdit);
}

export interface CreateEditInput {
  datasetId: string;
  kind: ExploreEditKind;
  target: ExploreEditTarget;
  value?: unknown;
  reason?: string | null;
  createdById: string;
}

export function validateEdit(input: Pick<CreateEditInput, "kind" | "target" | "value">): string | null {
  if (!EXPLORE_EDIT_KINDS.includes(input.kind)) return "Unknown edit kind";
  const { rowKey, column } = input.target ?? {};
  switch (input.kind) {
    case "cell":
      if (!rowKey || !column) return "A cell edit needs a rowKey and a column";
      return null;
    case "row-flag":
      if (!rowKey) return "A row flag needs a rowKey";
      if (typeof input.value !== "string" || !input.value.trim()) return "A row flag needs a text value";
      return null;
    case "row-exclude":
      if (!rowKey) return "A row exclusion needs a rowKey";
      return null;
    case "column-add": {
      if (!column) return "A new column needs a column key";
      const value = input.value as { label?: unknown; type?: unknown } | null;
      if (value && value.type && !["string", "number", "boolean", "date"].includes(String(value.type))) {
        return "Unsupported column type";
      }
      return null;
    }
    case "column-hide":
      if (!column) return "Hiding a column needs a column key";
      return null;
    default:
      return "Unknown edit kind";
  }
}

export async function createEdit(input: CreateEditInput): Promise<ExploreEditRecord> {
  const problem = validateEdit(input);
  if (problem) throw new Error(problem);
  const edit = await db.exploreDatasetEdit.create({
    data: {
      datasetId: input.datasetId,
      kind: input.kind,
      target: JSON.stringify(input.target),
      value: input.value === undefined ? null : JSON.stringify(input.value),
      reason: input.reason ?? null,
      createdById: input.createdById,
    },
  });
  return serializeEdit(edit);
}

export async function revokeEdit(id: string, datasetId: string, userId: string): Promise<boolean> {
  const result = await db.exploreDatasetEdit.updateMany({
    where: { id, datasetId, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: userId },
  });
  return result.count > 0;
}

/**
 * Apply active edits to a page of rows. Later edits win over earlier ones.
 * Excluded rows are dropped unless the caller asks for them (they then carry
 * `excluded: true` so a viewer can render them struck through).
 */
export function applyEditsToRows(
  rows: ExploreRowRecord[],
  edits: ExploreEditRecord[],
  options: { includeExcluded?: boolean } = {}
): ExploreRowRecord[] {
  const cellEdits = new Map<string, Map<string, unknown>>();
  const flags = new Map<string, string[]>();
  const excluded = new Set<string>();

  for (const edit of edits) {
    const rowKey = edit.target.rowKey;
    switch (edit.kind) {
      case "cell": {
        if (!rowKey || !edit.target.column) break;
        const perRow = cellEdits.get(rowKey) ?? new Map<string, unknown>();
        const value = edit.value as { value?: unknown } | null;
        perRow.set(edit.target.column, value && typeof value === "object" && "value" in value ? value.value : edit.value);
        cellEdits.set(rowKey, perRow);
        break;
      }
      case "row-flag": {
        if (!rowKey) break;
        const list = flags.get(rowKey) ?? [];
        if (typeof edit.value === "string") list.push(edit.value);
        flags.set(rowKey, list);
        break;
      }
      case "row-exclude": {
        if (rowKey) excluded.add(rowKey);
        break;
      }
      default:
        break;
    }
  }

  const out: ExploreRowRecord[] = [];
  for (const row of rows) {
    const rowKey = rowKeyOf(row);
    const isExcluded = excluded.has(rowKey);
    if (isExcluded && !options.includeExcluded) continue;
    const overrides = cellEdits.get(rowKey);
    const data = overrides ? { ...row.data } : row.data;
    const edited: string[] = [];
    if (overrides) {
      for (const [column, value] of overrides) {
        data[column] = value as ExploreRowRecord["data"][string];
        edited.push(column);
      }
    }
    out.push({
      ...row,
      data,
      rowKey,
      ...(flags.has(rowKey) ? { flags: flags.get(rowKey) } : {}),
      ...(isExcluded ? { excluded: true } : {}),
      ...(edited.length ? { edited } : {}),
    });
  }
  return out;
}

/** Columns added or hidden by edits, for the schema a viewer should render. */
export function applyEditsToColumns(
  columns: ExploreColumn[],
  edits: ExploreEditRecord[]
): { columns: ExploreColumn[]; hidden: string[] } {
  const added: ExploreColumn[] = [];
  const hidden = new Set<string>();
  for (const edit of edits) {
    if (edit.kind === "column-add" && edit.target.column) {
      const value = (edit.value ?? {}) as { label?: string; type?: ExploreColumn["type"] };
      if (!columns.some((column) => column.key === edit.target.column) && !added.some((column) => column.key === edit.target.column)) {
        added.push({
          key: edit.target.column,
          label: value.label || edit.target.column,
          type: value.type || "string",
          group: "curation",
        });
      }
    } else if (edit.kind === "column-hide" && edit.target.column) {
      hidden.add(edit.target.column);
    }
  }
  return { columns: [...columns, ...added], hidden: [...hidden] };
}
