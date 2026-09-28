/**
 * A table as a streamed file: the whole table, or the current view of it (search, filters, sort), written as it is
 * read so nothing large is held in memory. The unfiltered, unedited table is the stored data.tsv itself. A sorted view
 * must be read in full first (its order is only known then), so it is limited to MAX_DOWNLOAD_SORT_ROWS rows and says so.
 */
import { createReadStream } from "fs";
import type { ExploreDatasetVersion } from "@prisma/client";
import { fetchDatasetRows } from "./datasets";
import { applyEditsToRows, type ExploreEditRecord } from "./edits";
import { parseSchema } from "./schema";
import { queryOf } from "./table-page";
import { compileQuery, isPlain, readLayout, rowRecord, scanMatching, scanSorted, type CompiledQuery, type SortRow } from "./table-query";
import type { ExploreColumn } from "./types";

export const MAX_DOWNLOAD_SORT_ROWS = 200_000;
const WINDOW_ROWS = 5000;
const SCAN_FOREVER_MS = 6 * 60 * 60 * 1000;

export interface DownloadOptions {
  columns?: string | null;
  search?: string | null;
  sort?: string | null;
  filters?: string | null;
  format: "tsv" | "csv";
  signal?: AbortSignal;
}
export interface TableDownload {
  body: AsyncIterable<string | Buffer>;
  contentType: string;
  extension: string;
  /** Rows written when known before the first byte (the whole table, or a sorted view). */
  rows: number | null;
  /** Set when the file holds fewer rows than the view has, and why. */
  limited: "sort" | null;
}

const tsvCell = (value: unknown) => (value === null || value === undefined ? "" : String(typeof value === "object" ? JSON.stringify(value) : value).replace(/[\t\r\n]/g, " "));
const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(typeof value === "object" ? JSON.stringify(value) : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export async function openTableDownload(version: ExploreDatasetVersion, edits: ExploreEditRecord[], options: DownloadOptions): Promise<TableDownload> {
  const schema = parseSchema(version.schema);
  const wanted = options.columns ? new Set(options.columns.split(",").map((key) => key.trim()).filter(Boolean)) : null;
  const query = queryOf(options, schema.columns);
  const layout = version.storagePath ? await readLayout(version.storagePath) : null;
  const header = layout?.header ?? schema.columns.map((column) => column.key);
  const columns: ExploreColumn[] = schema.columns.filter((column) => header.includes(column.key) && !column.key.endsWith("_db_id") && (!wanted || wanted.has(column.key)));
  const keys = columns.map((column) => column.key);
  const asTsv = options.format === "tsv";
  const contentType = asTsv ? "text/tab-separated-values; charset=utf-8" : "text/csv; charset=utf-8";
  const line = (values: unknown[]) => `${values.map(asTsv ? tsvCell : csvCell).join(asTsv ? "\t" : ",")}\n`;

  // The stored file is the table: no parse, no copy in memory.
  if (isPlain(query) && !edits.length && layout && asTsv && !wanted && keys.length === header.length) {
    return { body: createReadStream(`${version.storagePath}/data.tsv`, { highWaterMark: 1 << 20 }), contentType, extension: "tsv", rows: version.rowCount, limited: null };
  }

  const compiled: CompiledQuery = compileQuery(header, schema.columns, query);
  const toRows = (batch: Array<{ rowIndex: number; cells: string[] }>) => {
    const records = batch.map((row) => rowRecord(header, row.cells, row.rowIndex));
    return (edits.length ? applyEditsToRows(records, edits) : records).map((record) => keys.map((key) => record.data[key]));
  };

  if (compiled.sorted) {
    const scan = layout
      ? await scanSorted(version.storagePath!, layout, compiled, { limit: 0, budgetMs: SCAN_FOREVER_MS, keep: MAX_DOWNLOAD_SORT_ROWS, signal: options.signal })
      : await sortDatabaseRows(version.id, header, compiled);
    const limited = scan.matched > scan.rows.length;
    const rows = toRows(scan.rows);
    async function* sorted() {
      yield line(columns.map((column) => column.label === column.key ? column.key : column.key));
      for (let i = 0; i < rows.length; i += 1000) yield rows.slice(i, i + 1000).map(line).join("");
    }
    return { body: sorted(), contentType, extension: asTsv ? "tsv" : "csv", rows: rows.length, limited: limited ? "sort" : null };
  }

  async function* windows() {
    yield line(keys);
    if (layout) {
      let start = 0;
      for (;;) {
        const scan = await scanMatching(version.storagePath!, layout, compiled, { start, limit: WINDOW_ROWS, budgetMs: SCAN_FOREVER_MS, signal: options.signal });
        if (scan.rows.length) yield toRows(scan.rows).map(line).join("");
        if (scan.end || scan.lastIndex === null || options.signal?.aborted) break;
        start = scan.lastIndex + 1;
      }
      return;
    }
    let cursor: string | null = null;
    for (;;) {
      const page = await fetchDatasetRows(version.id, { cursor, limit: 2000 });
      const kept = page.rows.filter((record) => compiled.matches(header.map((key) => tsvCell(record.data[key]))));
      if (kept.length) yield toRows(kept.map((record) => ({ rowIndex: record.rowIndex, cells: header.map((key) => tsvCell(record.data[key])) }))).map(line).join("");
      cursor = page.nextCursor;
      if (!cursor || options.signal?.aborted) break;
    }
  }
  return { body: windows(), contentType, extension: asTsv ? "tsv" : "csv", rows: isPlain(query) ? version.rowCount : null, limited: null };
}

async function sortDatabaseRows(versionId: string, header: string[], compiled: CompiledQuery) {
  const pool: Array<{ rowIndex: number; cells: string[]; key: SortRow["key"] }> = [];
  let matched = 0;
  let cursor: string | null = null;
  for (;;) {
    const page = await fetchDatasetRows(versionId, { cursor, limit: 2000 });
    for (const record of page.rows) {
      const cells = header.map((key) => tsvCell(record.data[key]));
      if (!compiled.matches(cells)) continue;
      matched += 1;
      pool.push({ rowIndex: record.rowIndex, cells, key: compiled.sortKey(cells) });
    }
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  pool.sort(compiled.compare);
  return { rows: pool.slice(0, MAX_DOWNLOAD_SORT_ROWS), matched };
}
