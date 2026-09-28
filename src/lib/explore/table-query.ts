/**
 * Searching, filtering and sorting a table that is too large to load: one engine over the version's data.tsv (every
 * version has one; a table above DB_MAX_CELLS has nothing else). A scan reads the file in big chunks with a time budget
 * and says how far it got, so a table of 20 million rows answers a first page in a second or two and a longer search
 * can be continued (the cursor is a row index) or stopped (the request's signal).
 *
 *  - Search alone takes a raw path: the chunk is lower-cased once and searched with indexOf, and only the lines that hit
 *    are split into cells (about 0.4 s for 1 million rows, under 1 s for 20 million).
 *  - Filters and sorts split each line into cells and compare typed values: numbers as numbers, everything else as
 *    lower-case text. A sort keeps the best `keep` rows while it scans (a bounded pool, trimmed as it grows) and
 *    reports the rows it read, so a partial scan is never taken for the whole table.
 */
import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { StringDecoder } from "string_decoder";
import type { ExploreColumn, ExploreColumnType, ExploreRowData, ExploreRowRecord } from "./types";

export const FILTER_OPS = ["contains", "eq", "gt", "gte", "lt", "lte", "empty", "notempty"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];
export interface TableFilter { column: string; op: FilterOp; value?: string }
export interface TableSortKey { column: string; dir: "asc" | "desc" }
export interface TableQuery { search: string | null; filters: TableFilter[]; sort: TableSortKey[] }

export const MAX_SORT_KEYS = 2;
export const MAX_FILTERS = 6;
/** A search or filter scan stops after this long and hands back what it found and where it got to. */
export const SCAN_BUDGET_MS = Number(process.env.SEQDESK_TABLE_SCAN_BUDGET_MS) > 0 ? Number(process.env.SEQDESK_TABLE_SCAN_BUDGET_MS) : 4000;
/** A sort must read the whole table to be exact, so it gets longer. */
export const SORT_BUDGET_MS = Number(process.env.SEQDESK_TABLE_SORT_BUDGET_MS) > 0 ? Number(process.env.SEQDESK_TABLE_SORT_BUDGET_MS) : 20000;
/** The most rows a sorted view keeps (and so the furthest page it can reach). */
export const MAX_SORT_ROWS = 50_000;

export class QueryInputError extends Error {}

export function emptyQuery(): TableQuery { return { search: null, filters: [], sort: [] }; }
export const isPlain = (query: TableQuery) => !query.search && !query.filters.length && !query.sort.length;
export const hasCondition = (query: TableQuery) => Boolean(query.search) || query.filters.length > 0;

/** `sort=Whole blood:desc,gene:asc`: at most two keys; the direction defaults to ascending. */
export function parseSort(text: string | null | undefined, columns: ExploreColumn[]): TableSortKey[] {
  if (!text) return [];
  const known = new Set(columns.map((column) => column.key));
  const keys: TableSortKey[] = [];
  for (const part of text.split(",")) {
    if (!part.trim()) continue;
    const at = part.lastIndexOf(":");
    const dirText = at >= 0 ? part.slice(at + 1).trim().toLowerCase() : "";
    const hasDir = dirText === "asc" || dirText === "desc";
    const column = (hasDir ? part.slice(0, at) : part).trim();
    if (!known.has(column)) throw new QueryInputError(`Cannot sort by ${column}: the table has no such column.`);
    if (!keys.some((key) => key.column === column)) keys.push({ column, dir: dirText === "desc" ? "desc" : "asc" });
  }
  if (keys.length > MAX_SORT_KEYS) throw new QueryInputError(`Sort by at most ${MAX_SORT_KEYS} columns.`);
  return keys;
}

/** `filters=[{"column":"chrom","op":"eq","value":"chr1"}]`. */
export function parseFilters(text: string | null | undefined, columns: ExploreColumn[]): TableFilter[] {
  if (!text) return [];
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new QueryInputError("The filters are not valid JSON."); }
  if (!Array.isArray(raw)) throw new QueryInputError("The filters must be a list.");
  if (raw.length > MAX_FILTERS) throw new QueryInputError(`Use at most ${MAX_FILTERS} filters.`);
  const known = new Set(columns.map((column) => column.key));
  return raw.map((item) => {
    const entry = item as { column?: unknown; op?: unknown; value?: unknown };
    if (typeof entry.column !== "string" || !known.has(entry.column)) throw new QueryInputError(`Cannot filter ${String(entry.column)}: the table has no such column.`);
    if (typeof entry.op !== "string" || !(FILTER_OPS as readonly string[]).includes(entry.op)) throw new QueryInputError(`Unknown filter condition ${String(entry.op)}.`);
    const op = entry.op as FilterOp;
    const value = entry.value === undefined || entry.value === null ? undefined : String(entry.value).slice(0, 200);
    if (op !== "empty" && op !== "notempty" && (value === undefined || value === "")) throw new QueryInputError("A filter needs a value.");
    return { column: entry.column, op, ...(value !== undefined ? { value } : {}) };
  });
}

const NUMBER = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)(e[+-]?\d+)?$/i;
/** A cell as a number when it reads as one (thousands separators are not guessed). */
export function numberOf(cell: string): number | null {
  const text = cell.trim();
  if (!NUMBER.test(text)) return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

/** How one cell compares with a filter value, by the column's type. Blank cells only match `empty`. */
function test(cell: string, filter: TableFilter, type: ExploreColumnType): boolean {
  const blank = cell.trim() === "";
  if (filter.op === "empty") return blank;
  if (filter.op === "notempty") return !blank;
  if (blank) return false;
  const wanted = filter.value ?? "";
  if (filter.op === "contains") return cell.toLowerCase().includes(wanted.toLowerCase());
  const a = numberOf(cell), b = numberOf(wanted);
  // Numbers compare as numbers in a number column, and for greater and less than anywhere; ids that look like numbers stay text for equals.
  if (a !== null && b !== null && (type === "number" || filter.op !== "eq")) {
    switch (filter.op) {
      case "eq": return a === b;
      case "gt": return a > b;
      case "gte": return a >= b;
      case "lt": return a < b;
      case "lte": return a <= b;
    }
  }
  const x = cell.trim().toLowerCase(), y = wanted.trim().toLowerCase();
  switch (filter.op) {
    case "eq": return x === y;
    case "gt": return x > y;
    case "gte": return x >= y;
    case "lt": return x < y;
    case "lte": return x <= y;
  }
  return false;
}

export interface CompiledQuery {
  needle: string | null;
  /** True when a row's cells (in header order) pass the search and every filter. */
  matches(cells: string[]): boolean;
  /** Negative when a sorts before b. Blank cells sort last in either direction. */
  compare(a: SortRow, b: SortRow): number;
  sortKey(cells: string[]): Array<number | string | null>;
  sorted: boolean;
  /** Any column filter (the raw search path only serves a plain search). */
  filtered: boolean;
}
export interface SortRow { rowIndex: number; key: Array<number | string | null> }

export function compileQuery(header: string[], columns: ExploreColumn[], query: TableQuery): CompiledQuery {
  const at = new Map(header.map((key, index) => [key, index]));
  const typeOf = new Map(columns.map((column) => [column.key, column.type]));
  const needle = query.search ? query.search.toLowerCase().replace(/[\t\r\n]+/g, " ").trim() || null : null;
  const conditions = query.filters.map((filter) => ({ index: at.get(filter.column) ?? -1, filter, type: typeOf.get(filter.column) ?? "string" as ExploreColumnType }));
  const keys = query.sort.map((key) => ({ index: at.get(key.column) ?? -1, dir: key.dir === "desc" ? -1 : 1, numeric: typeOf.get(key.column) === "number" }));
  return {
    needle,
    sorted: keys.length > 0,
    filtered: conditions.length > 0,
    matches(cells) {
      for (const condition of conditions) {
        if (condition.index < 0 || !test(cells[condition.index] ?? "", condition.filter, condition.type)) return false;
      }
      if (needle && !cells.some((cell) => cell !== "" && cell.toLowerCase().includes(needle))) return false;
      return true;
    },
    sortKey(cells) {
      return keys.map((key) => {
        const cell = (cells[key.index] ?? "").trim();
        if (cell === "") return null;
        const number = numberOf(cell);
        return key.numeric && number !== null ? number : number !== null ? number : cell.toLowerCase();
      });
    },
    compare(a, b) {
      for (let i = 0; i < keys.length; i += 1) {
        const x = a.key[i], y = b.key[i];
        if (x === null || y === null) { if (x === y) continue; return x === null ? 1 : -1; }
        // A number sorts before text in one column, so mixed columns stay in a predictable order.
        let c = typeof x === "number" && typeof y === "number" ? x - y : typeof x === "number" ? -1 : typeof y === "number" ? 1 : x < y ? -1 : x > y ? 1 : 0;
        if (c === 0) continue;
        c *= keys[i].dir;
        return c;
      }
      return a.rowIndex - b.rowIndex;
    },
  };
}

/** The header of a version file and where the rows start; the row index (rows.idx.json) when there is one. */
export interface FileLayout { header: string[]; index: { every: number; offsets: number[]; rows: number } | null; headerBytes: number }
export async function readLayout(storagePath: string): Promise<FileLayout | null> {
  const file = path.join(storagePath, "data.tsv");
  let handle: fs.FileHandle;
  try { handle = await fs.open(file, "r"); } catch { return null; }
  try {
    const buffer = Buffer.alloc(1 << 20);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const end = text.indexOf("\n");
    if (end < 0 && bytesRead === buffer.length) return null;
    const line = end < 0 ? text : text.slice(0, end);
    let index: FileLayout["index"] = null;
    try { index = JSON.parse(await fs.readFile(path.join(storagePath, "rows.idx.json"), "utf8")); } catch { /* no index: scan from the top */ }
    return { header: (line.endsWith("\r") ? line.slice(0, -1) : line).split("\t"), index, headerBytes: Buffer.byteLength(line) + 1 };
  } finally { await handle.close(); }
}

export interface ScanOptions {
  /** First row index to read. */
  start?: number;
  /** Stop once this many matching rows are in hand (0: keep reading, a sort or a count). */
  limit: number;
  budgetMs: number;
  signal?: AbortSignal;
  /** Keep the best `keep` rows by the sort instead of the first `limit`. */
  keep?: number;
  /** Bytes read at a time (the time budget and the hang-up are checked between chunks). */
  chunkBytes?: number;
}
export interface ScanResult {
  rows: Array<{ rowIndex: number; cells: string[] }>;
  /** Rows read from `start` on, matching or not. */
  scanned: number;
  /** Rows that matched among those read. */
  matched: number;
  /** The scan read to the end of the file. */
  end: boolean;
  /** Why it stopped early: enough matches, the time budget, or the caller hanging up. */
  stopped: "end" | "limit" | "budget" | "aborted";
  /** The last row index read (the cursor to continue from). */
  lastIndex: number | null;
}

/** Position of the row block holding `start`: file offset and the row index at that offset. */
function seekTo(layout: FileLayout, start: number): { position: number; rowIndex: number; skipHeader: boolean } {
  if (layout.index && layout.index.offsets.length) {
    const block = Math.min(Math.floor(start / layout.index.every), layout.index.offsets.length - 1);
    return { position: layout.index.offsets[block], rowIndex: block * layout.index.every, skipHeader: false };
  }
  return { position: 0, rowIndex: 0, skipHeader: true };
}

/**
 * Read a version file forward from `start`, calling `visit` for every row (cells split on tabs). Chunks are large and
 * lines are found with indexOf, so the cost is the split and the caller's test, not per-line stream overhead.
 */
async function forEachRow(storagePath: string, layout: FileLayout, options: ScanOptions, visit: (cells: string[], rowIndex: number) => boolean | void, raw?: { needle: string; confirm: (cells: string[]) => boolean; visitRaw: (cells: string[], rowIndex: number) => boolean | void }): Promise<{ scanned: number; end: boolean; stopped: ScanResult["stopped"]; lastIndex: number | null }> {
  const start = Math.max(0, options.start ?? 0);
  const here = seekTo(layout, start);
  const stream = createReadStream(path.join(storagePath, "data.tsv"), { start: here.position, highWaterMark: options.chunkBytes ?? 4 << 20 });
  const decoder = new StringDecoder("utf8");
  const began = Date.now();
  if (options.signal?.aborted) { stream.destroy(); return { scanned: 0, end: false, stopped: "aborted", lastIndex: null }; }
  const total = layout.index?.rows ?? Infinity;
  let rowIndex = here.rowIndex;
  let skipHeader = here.skipHeader;
  let tail = "";
  let lastIndex: number | null = null;
  let stopped: ScanResult["stopped"] = "end";
  const stop = (why: ScanResult["stopped"]) => { stopped = why; };
  try {
    outer: for await (const buffer of stream) {
      const text = tail + decoder.write(buffer as Buffer);
      const cut = text.lastIndexOf("\n");
      if (cut < 0) { tail = text; continue; }
      const block = text.slice(0, cut + 1);
      tail = text.slice(cut + 1);
      let lineStart = 0;
      if (skipHeader) { lineStart = block.indexOf("\n") + 1; skipHeader = false; }
      // Raw path: only lines containing the needle are split. Rows before `start` (up to one index block) are skipped.
      if (raw) {
        const lower = block.toLowerCase();
        if (lower.length === block.length) {
          let at = rowIndex, pos = lineStart, from = lineStart;
          for (let hit = lower.indexOf(raw.needle, from); hit >= 0; hit = lower.indexOf(raw.needle, from)) {
            for (let nl = block.indexOf("\n", pos); nl >= 0 && nl < hit; nl = block.indexOf("\n", pos)) { at += 1; pos = nl + 1; }
            const end = block.indexOf("\n", hit);
            if (at < start) { at += 1; pos = end + 1; from = pos; continue; }
            const line = block.slice(pos, end);
            const cells = (line.endsWith("\r") ? line.slice(0, -1) : line).split("\t");
            if (at < total && raw.confirm(cells)) {
              if (raw.visitRaw(cells, at) === false) { lastIndex = at; rowIndex = at + 1; stop("limit"); break outer; }
            }
            at += 1; pos = end + 1; from = pos;
          }
          // The rest of the block holds no hit: count its rows.
          for (let nl = block.indexOf("\n", pos); nl >= 0; nl = block.indexOf("\n", pos)) { at += 1; pos = nl + 1; }
          const readTo = Math.min(at, total);
          lastIndex = readTo - 1;
          rowIndex = at;
          if (rowIndex >= total) break;
          if (options.signal?.aborted) { stop("aborted"); break; }
          if (Date.now() - began > options.budgetMs) { stop("budget"); break; }
          continue;
        }
        // A character that changes length in lower case (a few Unicode letters): read this block line by line instead.
      }
      for (let nl = block.indexOf("\n", lineStart); nl >= 0; nl = block.indexOf("\n", lineStart)) {
        const at = rowIndex;
        const line = block.slice(lineStart, nl);
        lineStart = nl + 1;
        rowIndex += 1;
        if (at >= total) break outer;
        if (at < start) continue;
        lastIndex = at;
        if (visit((line.endsWith("\r") ? line.slice(0, -1) : line).split("\t"), at) === false) { stop("limit"); break outer; }
      }
      if (rowIndex >= total) break;
      if (options.signal?.aborted) { stop("aborted"); break; }
      if (Date.now() - began > options.budgetMs) { stop("budget"); break; }
    }
    // A final line without a newline (files written by hand).
    if (stopped === "end" && !layout.index) {
      const last = tail + decoder.end();
      if (last && rowIndex >= start) { lastIndex = rowIndex; visit((last.endsWith("\r") ? last.slice(0, -1) : last).split("\t"), rowIndex); rowIndex += 1; }
    }
  } finally { stream.destroy(); }
  const end = stopped === "end" || (layout.index ? rowIndex >= total : false);
  const scanned = lastIndex === null ? 0 : Math.max(0, lastIndex + 1 - start);
  return { scanned, end, stopped: end && stopped === "budget" ? "end" : stopped, lastIndex };
}

/** Rows that match, in file order, from `start`: search only takes the raw path. */
export async function scanMatching(storagePath: string, layout: FileLayout, compiled: CompiledQuery, options: ScanOptions): Promise<ScanResult> {
  const rows: ScanResult["rows"] = [];
  let matched = 0;
  const take = (cells: string[], rowIndex: number) => {
    matched += 1;
    rows.push({ rowIndex, cells });
    return options.limit > 0 && rows.length >= options.limit ? false : true;
  };
  const raw = compiled.needle && !compiled.filtered && !options.keep ? { needle: compiled.needle, confirm: compiled.matches, visitRaw: take } : undefined;
  const result = await forEachRow(storagePath, layout, options, (cells, rowIndex) => (compiled.matches(cells) ? take(cells, rowIndex) : true), raw);
  return { rows, scanned: result.scanned, matched, end: result.end && result.stopped === "end", stopped: result.end ? "end" : result.stopped, lastIndex: result.lastIndex };
}

/**
 * The first `keep` rows by the sort among those that match. Reads the whole file when the budget allows; otherwise
 * `end` is false and the caller says the order holds for the rows read.
 */
export async function scanSorted(storagePath: string, layout: FileLayout, compiled: CompiledQuery, options: ScanOptions & { keep: number }): Promise<ScanResult & { pool: Array<{ rowIndex: number; cells: string[]; key: SortRow["key"] }> }> {
  let pool: Array<{ rowIndex: number; cells: string[]; key: SortRow["key"] }> = [];
  let matched = 0;
  const trim = () => { pool.sort(compiled.compare); pool = pool.slice(0, options.keep); };
  const result = await forEachRow(storagePath, layout, { ...options, limit: 0 }, (cells, rowIndex) => {
    if (!compiled.matches(cells)) return true;
    matched += 1;
    pool.push({ rowIndex, cells, key: compiled.sortKey(cells) });
    if (pool.length > options.keep * 2 + 64) trim();
    return true;
  });
  trim();
  return { rows: pool, pool, scanned: result.scanned, matched, end: result.end, stopped: result.stopped, lastIndex: result.lastIndex };
}

/** A row as the API returns it: cells by column key, blank as null. */
export function rowRecord(header: string[], cells: string[], rowIndex: number): ExploreRowRecord {
  const data: ExploreRowData = {};
  for (let i = 0; i < header.length; i += 1) { const cell = cells[i]; data[header[i]] = cell === undefined || cell === "" ? null : cell; }
  return { rowIndex, sampleId: null, subjectId: null, key: null, data };
}
