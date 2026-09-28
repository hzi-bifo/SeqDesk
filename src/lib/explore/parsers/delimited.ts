import { coerceCell, normalizeColumnKey } from "../schema";
import type { ExploreRowData } from "../types";

export class DelimitedParseError extends Error {}

export interface DelimitedParseOptions {
  delimiter?: "\t" | "," | ";" | "auto";
  /** Lines starting with this prefix are skipped before the header. */
  skipLinesStartingWith?: string;
  /** Locate and strip a marked header after any metadata preamble, e.g. CAMI @@. */
  headerLinePrefix?: string;
  /** Maximum number of data rows to read; the rest is reported as truncated. */
  maxRows?: number;
  /**
   * QIIME/biom style "#" lines: a "#" line before the header with fewer fields than the next line is a preamble
   * ("# Constructed from biom file") and skipped, a "#" header ("#OTU ID", "#SampleID") is kept (the key loses the
   * "#"), and "#" lines after the header ("#q2:types" directives, comments) are left out of the rows.
   */
  hashComments?: boolean;
}

export interface DelimitedParseResult {
  columns: string[];
  rows: ExploreRowData[];
  truncated: boolean;
  delimiter: string;
}

export function detectDelimiter(headerLine: string): "\t" | "," | ";" {
  let tabs = 0, commas = 0, semis = 0, quoted = false;
  for (let index = 0; index < headerLine.length; index++) {
    const char = headerLine[index];
    if (char === '"') {
      if (quoted && headerLine[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (char === "\t") tabs++;
      else if (char === ",") commas++;
      else if (char === ";") semis++;
    }
  }
  if (tabs >= commas && tabs >= semis) return "\t";
  return semis > commas ? ";" : ",";
}

/** Split one line honouring double-quoted fields (RFC 4180 style). */
export function splitLine(line: string, delimiter: string): string[] | null {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  let closed = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        current += char;
      }
    } else if (char === '"' && current === "") {
      quoted = true;
    } else if (char === delimiter) {
      out.push(current);
      current = "";
      closed = false;
    } else if (closed && char.trim() !== "") {
      throw new DelimitedParseError("Unexpected text after a quoted field");
    } else {
      current += char;
    }
  }
  if (quoted) return null;
  out.push(current);
  return out;
}

export function uniqueColumnKeys(headers: string[]): string[] {
  const used = new Set<string>();
  return headers.map((header, index) => {
    const base = normalizeColumnKey(header || `column_${index + 1}`);
    let key = base;
    let suffix = 2;
    while (used.has(key)) key = `${base}_${suffix++}`;
    used.add(key);
    return key;
  });
}

/**
 * Parse delimited text into row objects keyed by normalized header names.
 * Empty lines are ignored, a trailing CR is stripped, and cells are coerced
 * with the same rules as every other Explore source.
 */
export function parseDelimited(text: string, options: DelimitedParseOptions = {}): DelimitedParseResult {
  const lines = text.split(/\r?\n/);
  const skipPrefix = options.skipLinesStartingWith;
  let headerIndex = options.headerLinePrefix
    ? lines.findIndex(line => line.startsWith(options.headerLinePrefix!))
    : 0;
  if (headerIndex < 0) throw new Error("Declared table header was not found");
  while (headerIndex < lines.length) {
    const line = lines[headerIndex];
    if (options.headerLinePrefix && line.startsWith(options.headerLinePrefix)) break;
    if (line.trim() === "" || (skipPrefix && line.startsWith(skipPrefix))) {
      headerIndex += 1;
      continue;
    }
    break;
  }
  if (headerIndex >= lines.length) {
    return { columns: [], rows: [], truncated: false, delimiter: "\t" };
  }
  if (options.hashComments && !options.headerLinePrefix) {
    const fields = (line: string) => line.split(detectDelimiter(line)).length;
    while (lines[headerIndex]?.startsWith("#")) {
      let next = headerIndex + 1;
      while (next < lines.length && lines[next].trim() === "") next += 1;
      if (next >= lines.length || fields(lines[headerIndex]) >= fields(lines[next])) break;
      headerIndex = next;
    }
  }
  const header = lines[headerIndex].slice(options.headerLinePrefix?.length ?? 0);
  const skipped = (line: string) => line.trim() === "" || Boolean(skipPrefix && line.startsWith(skipPrefix)) || Boolean(options.hashComments && line.startsWith("#"));
  const delimiter =
    !options.delimiter || options.delimiter === "auto" ? detectDelimiter(header) : options.delimiter;
  const recordAt = (start: number, initial = lines[start]) => {
    let line = initial, end = start;
    let cells = splitLine(line, delimiter);
    while (cells === null) {
      end += 1;
      if (end >= lines.length) throw new DelimitedParseError(`Unclosed quoted field starting on line ${start + 1}`);
      line += "\n" + lines[end];
      cells = splitLine(line, delimiter);
    }
    return { cells, end };
  };
  const headerRecord = recordAt(headerIndex, header);
  headerIndex = headerRecord.end;
  let columns = uniqueColumnKeys(headerRecord.cells.map((header) => header.trim()));
  // R's write.table(row.names = TRUE) leaves the row-name column out of the header, so every data line has one
  // field more than the header. When the first data lines (at least two) all do, name that leading column row_name
  // instead of rejecting the file; a lone line with an extra field is still an error below.
  const widths: number[] = [];
  for (let index = headerIndex + 1; index < lines.length && widths.length < 3; index += 1) {
    if (skipped(lines[index])) continue;
    const record = recordAt(index);
    widths.push(record.cells.length);
    index = record.end;
  }
  if (widths.length >= 2 && widths.every((width) => width === columns.length + 1)) {
    columns = uniqueColumnKeys(["row_name", ...headerRecord.cells.map((header) => header.trim())]);
  }
  const rows: ExploreRowData[] = [];
  let truncated = false;
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (skipped(line)) continue;
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    const record = recordAt(index);
    const cells = record.cells;
    if (cells.length > columns.length) throw new DelimitedParseError(`Line ${index + 1} has more fields than the header`);
    index = record.end;
    const row: ExploreRowData = {};
    columns.forEach((column, columnIndex) => {
      row[column] = coerceCell(cells[columnIndex] ?? null);
    });
    rows.push(row);
  }
  return { columns, rows, truncated, delimiter };
}
