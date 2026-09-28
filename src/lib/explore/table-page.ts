/**
 * One page of a table for the web app: the rows after a cursor, only the requested columns, curation edits
 * applied, and at most MAX_RESPONSE_CELLS cells so a 10,000-column table answers with a few rows instead of
 * a response of hundreds of megabytes. Search (`q`) runs on the server: a JSON scan in Postgres, or a bounded
 * scan of the file for file-backed tables.
 */
import type { ExploreDatasetVersion } from "@prisma/client";
import { db } from "@/lib/db";
import { fetchDatasetRows } from "./datasets";
import { applyEditsToRows, type ExploreEditRecord } from "./edits";
import { parseSchema } from "./schema";
import { fileStorageOf, readRowsFromFile } from "./table-store";
import type { ExploreCell, ExploreColumn, ExploreRowData, ExploreRowRecord } from "./types";

export const MAX_RESPONSE_CELLS = 1_000_000;
export const MAX_RESPONSE_ROWS = 250_000;
/** A file-backed search reads at most this many rows before it answers with what it found. */
export const FILE_SEARCH_SCAN_ROWS = 5_000_000;
const PAGE = 2000;

export interface TablePageOptions {
  columns?: string | null;
  limit: number;
  cursor?: string | null;
  search?: string | null;
}

export function pageRowLimit(requested: number, columnCount: number): { limit: number; limitedBy: "cells" | null } {
  const byRows = Math.min(MAX_RESPONSE_ROWS, Math.max(1, requested));
  const byCells = Math.max(1, Math.floor(MAX_RESPONSE_CELLS / Math.max(1, columnCount)));
  return byCells < byRows ? { limit: byCells, limitedBy: "cells" } : { limit: byRows, limitedBy: null };
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export async function readTablePage(version: ExploreDatasetVersion | null, edits: ExploreEditRecord[], options: TablePageOptions) {
  const schema = parseSchema(version?.schema);
  const wanted = options.columns ? new Set(options.columns.split(",").map((key) => key.trim()).filter(Boolean)) : null;
  const columns: ExploreColumn[] = schema.columns.filter((column) => !column.key.endsWith("_db_id") && (!wanted || wanted.has(column.key)));
  const fileBacked = Boolean(version && fileStorageOf(version.provenance));
  const { limit, limitedBy } = pageRowLimit(options.limit, columns.length);
  const search = options.search?.trim().slice(0, 200) || null;
  const cursorIndex = options.cursor && /^\d+$/.test(options.cursor) ? Number(options.cursor) : null;
  const excluded = new Set(edits.filter((edit) => edit.kind === "row-exclude" && edit.target.rowKey).map((edit) => edit.target.rowKey)).size;
  const empty = { fileBacked, rowEntity: schema.rowEntity, body: { columns, rows: [] as ExploreRowData[], total: 0, truncated: false, nextCursor: null as string | null, limitedBy, search: search ? { query: search, complete: true } : null } };
  if (!version) return empty;

  let records: ExploreRowRecord[] = [];
  let nextCursor: string | null = null;
  let complete = true;
  if (search && fileBacked) {
    const needle = search.toLowerCase();
    const keys = schema.columns.map((column) => column.key);
    const page = await readRowsFromFile(version.storagePath!, keys, {
      start: cursorIndex === null ? 0 : cursorIndex + 1, limit: limit + 1, scanLimit: FILE_SEARCH_SCAN_ROWS,
      filter: (row) => Object.values(row).some((value) => value !== null && String(value).toLowerCase().includes(needle)),
    });
    records = page.rows;
    complete = page.end || records.length > limit;
    if (records.length > limit) nextCursor = String(records[limit - 1].rowIndex);
    else if (!page.end && page.lastIndex !== null) nextCursor = String(page.lastIndex);
  } else if (search) {
    const found = await db.$queryRaw<Array<{ rowIndex: number; sampleId: string | null; subjectId: string | null; key: string | null; data: ExploreRowData }>>`
      SELECT "rowIndex", "sampleId", "subjectId", "key", "data" FROM "ExploreDatasetRow"
      WHERE "versionId" = ${version.id} AND "rowIndex" > ${cursorIndex ?? -1}
        AND EXISTS (SELECT 1 FROM jsonb_each_text("data") AS cell WHERE cell.value ILIKE ${`%${escapeLike(search)}%`})
      ORDER BY "rowIndex" LIMIT ${limit + 1}`;
    records = found.map((row) => ({ ...row, rowIndex: Number(row.rowIndex) }));
    if (records.length > limit) nextCursor = String(records[limit - 1].rowIndex);
  } else {
    let cursor = cursorIndex === null ? null : String(cursorIndex);
    while (records.length <= limit) {
      const page = await fetchDatasetRows(version.id, { cursor, limit: Math.min(PAGE, limit + 1 - records.length) });
      records.push(...page.rows);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    if (records.length > limit) nextCursor = String(records[limit - 1].rowIndex);
  }
  const more = records.length > limit || nextCursor !== null;
  const shown = applyEditsToRows(records.slice(0, limit), edits);
  const keys = columns.map((column) => column.key);
  const rows = shown.map((record) => {
    if (!wanted) return record.data;
    const picked: Record<string, ExploreCell | undefined> = {};
    for (const key of keys) picked[key] = record.data[key];
    return picked as ExploreRowData;
  });
  const total = search ? rows.length + (more ? 1 : 0) : Math.max(0, version.rowCount - excluded);
  return { fileBacked, rowEntity: schema.rowEntity, body: {
    columns, rows, total, truncated: more, nextCursor: more ? nextCursor : null, limitedBy: more ? limitedBy : null,
    search: search ? { query: search, complete: complete && !more, matched: rows.length } : null,
  } };
}
