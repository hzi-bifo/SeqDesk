/**
 * One page of a table for the web app: the rows after a cursor, only the requested columns, curation edits
 * applied, and at most MAX_RESPONSE_CELLS cells so a 10,000-column table answers with a few rows instead of
 * a response of hundreds of megabytes.
 *
 * Search, column filters and sorting (table-query.ts) run on the server over every row: a scan of the version's
 * data.tsv with a time budget, so the answer says how many rows it read and can be continued (the cursor is a row
 * index; a sorted view pages by offset). Older callers that only send `q` get the same page shape.
 */
import type { ExploreDatasetVersion } from "@prisma/client";
import { db } from "@/lib/db";
import { fetchDatasetRows } from "./datasets";
import { applyEditsToRows, type ExploreEditRecord } from "./edits";
import { parseSchema } from "./schema";
import { fileStorageOf } from "./table-store";
import {
  MAX_SORT_ROWS, QueryInputError, SCAN_BUDGET_MS, SORT_BUDGET_MS, compileQuery, emptyQuery, hasCondition, isPlain, parseFilters, parseSort, readLayout, rowRecord, scanMatching, scanSorted,
  type CompiledQuery, type FileLayout, type ScanResult, type SortRow, type TableQuery,
} from "./table-query";
import type { ExploreCell, ExploreColumn, ExploreRowData, ExploreRowRecord } from "./types";

export const MAX_RESPONSE_CELLS = 1_000_000;
export const MAX_RESPONSE_ROWS = 250_000;
const PAGE = 2000;

export interface TablePageOptions {
  columns?: string | null;
  limit: number;
  cursor?: string | null;
  search?: string | null;
  /** `column:asc,column2:desc`. */
  sort?: string | null;
  /** JSON list of {column, op, value}. */
  filters?: string | null;
  signal?: AbortSignal;
  budgetMs?: number;
}

export function pageRowLimit(requested: number, columnCount: number): { limit: number; limitedBy: "cells" | null } {
  const byRows = Math.min(MAX_RESPONSE_ROWS, Math.max(1, requested));
  const byCells = Math.max(1, Math.floor(MAX_RESPONSE_CELLS / Math.max(1, columnCount)));
  return byCells < byRows ? { limit: byCells, limitedBy: "cells" } : { limit: byRows, limitedBy: null };
}

/** The query of a request, checked against the table's columns. Throws QueryInputError with a sentence for the person. */
export function queryOf(options: Pick<TablePageOptions, "search" | "sort" | "filters">, columns: ExploreColumn[]): TableQuery {
  const search = options.search?.trim().slice(0, 200) || null;
  return { search, filters: parseFilters(options.filters, columns), sort: parseSort(options.sort, columns) };
}

const cellText = (value: ExploreCell | undefined): string => (value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));

/** Rows of a table that has no usable data.tsv (or none the engine can read): the Postgres rows, a page at a time. */
async function scanDatabase(versionId: string, header: string[], compiled: CompiledQuery, options: { start: number; limit: number; budgetMs: number; keep?: number; signal?: AbortSignal }): Promise<ScanResult & { pool: Array<{ rowIndex: number; cells: string[]; key: SortRow["key"] }> }> {
  const began = Date.now();
  const rows: ScanResult["rows"] = [];
  let pool: Array<{ rowIndex: number; cells: string[]; key: SortRow["key"] }> = [];
  let matched = 0, scanned = 0;
  let cursor: string | null = options.start > 0 ? String(options.start - 1) : null;
  let lastIndex: number | null = null;
  let stopped: ScanResult["stopped"] = "end";
  const trim = () => { pool.sort(compiled.compare); pool = pool.slice(0, options.keep ?? 0); };
  outer: for (;;) {
    const page = await fetchDatasetRows(versionId, { cursor, limit: PAGE });
    for (const record of page.rows) {
      scanned += 1;
      lastIndex = record.rowIndex;
      const cells = header.map((key) => cellText(record.data[key]));
      if (!compiled.matches(cells)) continue;
      matched += 1;
      if (options.keep) { pool.push({ rowIndex: record.rowIndex, cells, key: compiled.sortKey(cells) }); if (pool.length > options.keep * 2 + 64) trim(); }
      else { rows.push({ rowIndex: record.rowIndex, cells }); if (options.limit > 0 && rows.length >= options.limit) { stopped = "limit"; break outer; } }
    }
    cursor = page.nextCursor;
    if (!cursor) break;
    if (options.signal?.aborted) { stopped = "aborted"; break; }
    if (Date.now() - began > options.budgetMs) { stopped = "budget"; break; }
  }
  if (options.keep) trim();
  const end = stopped === "end";
  return { rows: options.keep ? pool : rows, pool, scanned, matched, end, stopped, lastIndex };
}

interface SortedCacheEntry { at: number; keep: number; pool: Array<{ rowIndex: number; cells: string[] }>; matched: number; scanned: number; end: boolean }
const sortedCache = new Map<string, SortedCacheEntry>();
const CACHE_MS = 120_000;
const CACHE_ENTRIES = 6;

function cacheGet(key: string): SortedCacheEntry | null {
  const entry = sortedCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_MS) { sortedCache.delete(key); return null; }
  return entry;
}
function cachePut(key: string, entry: SortedCacheEntry) {
  sortedCache.set(key, entry);
  while (sortedCache.size > CACHE_ENTRIES) sortedCache.delete(sortedCache.keys().next().value as string);
}
export function clearTableQueryCache() { sortedCache.clear(); }

/** Header (the keys of data.tsv) and layout of a version, or null when it has no readable file. */
async function layoutOf(version: ExploreDatasetVersion): Promise<FileLayout | null> {
  return version.storagePath ? readLayout(version.storagePath) : null;
}

export async function readTablePage(version: ExploreDatasetVersion | null, edits: ExploreEditRecord[], options: TablePageOptions) {
  const schema = parseSchema(version?.schema);
  const wanted = options.columns ? new Set(options.columns.split(",").map((key) => key.trim()).filter(Boolean)) : null;
  const columns: ExploreColumn[] = schema.columns.filter((column) => !column.key.endsWith("_db_id") && (!wanted || wanted.has(column.key)));
  const fileBacked = Boolean(version && fileStorageOf(version.provenance));
  const { limit, limitedBy } = pageRowLimit(options.limit, columns.length);
  const query = queryOf(options, schema.columns);
  const scanning = !isPlain(query);
  const excluded = new Set(edits.filter((edit) => edit.kind === "row-exclude" && edit.target.rowKey).map((edit) => edit.target.rowKey)).size;
  const emptyView = scanning ? { search: query.search, filters: query.filters, sort: query.sort, matched: 0, scanned: 0, rows: 0, complete: true, stopped: "end" as const, budgetMs: 0 } : null;
  const empty = { fileBacked, rowEntity: schema.rowEntity, body: { columns, rows: [] as ExploreRowData[], total: 0, truncated: false, nextCursor: null as string | null, limitedBy, search: query.search ? { query: query.search, complete: true } : null, view: emptyView } };
  if (!version) return empty;

  const cursorText = options.cursor ?? "";
  const cursorIndex = /^\d+$/.test(cursorText) ? Number(cursorText) : null;
  const offset = /^o\d+$/.test(cursorText) ? Number(cursorText.slice(1)) : 0;

  let records: ExploreRowRecord[] = [];
  let nextCursor: string | null = null;
  let view: NonNullable<typeof emptyView> | null = null;
  let total = Math.max(0, version.rowCount - excluded);

  if (scanning) {
    const layout = await layoutOf(version);
    const header = layout?.header ?? schema.columns.map((column) => column.key);
    const compiled = compileQuery(header, schema.columns, query);
    const rowsTotal = version.rowCount;
    const toRecord = (row: { rowIndex: number; cells: string[] }) => rowRecord(header, row.cells, row.rowIndex);
    if (compiled.sorted) {
      const keep = Math.min(MAX_SORT_ROWS, offset + limit + 1);
      const signature = JSON.stringify([version.id, query, edits.length]);
      let entry = cacheGet(signature);
      // The pool holds the best rows it kept; a page past its end needs a bigger one when the scan stopped at the cap.
      const needMore = entry ? offset + limit + 1 > entry.pool.length && entry.pool.length >= entry.keep && entry.keep < MAX_SORT_ROWS : false;
      if (!entry || needMore) {
        const budgetMs = options.budgetMs ?? SORT_BUDGET_MS;
        const want = Math.min(MAX_SORT_ROWS, Math.max(keep, entry ? entry.keep * 4 : 4000));
        const scan = layout ? await scanSorted(version.storagePath!, layout, compiled, { limit: 0, budgetMs, keep: want, signal: options.signal })
          : await scanDatabase(version.id, header, compiled, { start: 0, limit: 0, budgetMs, keep: want, signal: options.signal });
        entry = { at: Date.now(), keep: want, pool: scan.rows, matched: scan.matched, scanned: scan.scanned, end: scan.end };
        if (!options.signal?.aborted) cachePut(signature, entry);
      }
      const page = entry.pool.slice(offset, offset + limit);
      const more = entry.pool.length > offset + limit && offset + limit < MAX_SORT_ROWS;
      records = page.map(toRecord);
      nextCursor = more ? `o${offset + limit}` : null;
      total = entry.matched;
      view = { ...emptyView!, matched: entry.matched, scanned: entry.scanned, rows: rowsTotal, complete: entry.end, stopped: entry.end ? "end" : "budget", budgetMs: options.budgetMs ?? SORT_BUDGET_MS };
      (view as Record<string, unknown>).sortedRows = entry.pool.length;
      if (entry.pool.length >= MAX_SORT_ROWS && entry.matched > MAX_SORT_ROWS) (view as Record<string, unknown>).sortLimited = MAX_SORT_ROWS;
    } else {
      const start = cursorIndex === null ? 0 : cursorIndex + 1;
      const budgetMs = options.budgetMs ?? SCAN_BUDGET_MS;
      const scan = layout ? await scanMatching(version.storagePath!, layout, compiled, { start, limit: limit + 1, budgetMs, signal: options.signal })
        : await scanDatabase(version.id, header, compiled, { start, limit: limit + 1, budgetMs, signal: options.signal });
      const page = scan.rows.slice(0, limit);
      const more = scan.rows.length > limit;
      records = page.map(toRecord);
      // Enough matches: continue after the last one shown. Budget spent: continue after the last row read.
      nextCursor = more ? String(page[page.length - 1].rowIndex) : !scan.end && scan.lastIndex !== null ? String(scan.lastIndex) : null;
      total = page.length + (nextCursor !== null ? 1 : 0);
      view = { ...emptyView!, matched: scan.matched, scanned: scan.scanned + start, rows: rowsTotal, complete: scan.end && !more, stopped: more ? "limit" : scan.end ? "end" : scan.stopped as "budget", budgetMs };
      (view as Record<string, unknown>).from = start;
    }
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
  const more = scanning ? nextCursor !== null : records.length > limit || nextCursor !== null;
  const shown = applyEditsToRows(scanning ? records : records.slice(0, limit), edits);
  const keys = columns.map((column) => column.key);
  const rows = shown.map((record) => {
    if (!wanted) return record.data;
    const picked: Record<string, ExploreCell | undefined> = {};
    for (const key of keys) picked[key] = record.data[key];
    return picked as ExploreRowData;
  });
  return { fileBacked, rowEntity: schema.rowEntity, body: {
    columns, rows, total, truncated: more, nextCursor: more ? nextCursor : null, limitedBy: more ? limitedBy : null,
    search: query.search ? { query: query.search, complete: view ? view.complete : true, matched: view?.matched ?? rows.length, scanned: view?.scanned, rows: view?.rows } : null,
    view,
  } };
}

export { QueryInputError, hasCondition, emptyQuery };
