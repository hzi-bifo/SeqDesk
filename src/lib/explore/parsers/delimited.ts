import { coerceCell, normalizeColumnKey } from "../schema";
import type { ExploreRowData } from "../types";

export interface DelimitedParseOptions {
  delimiter?: "\t" | "," | ";" | "auto";
  /** Lines starting with this prefix are skipped before the header. */
  skipLinesStartingWith?: string;
  /** Maximum number of data rows to read; the rest is reported as truncated. */
  maxRows?: number;
}

export interface DelimitedParseResult {
  columns: string[];
  rows: ExploreRowData[];
  truncated: boolean;
  delimiter: string;
}

function detectDelimiter(headerLine: string): "\t" | "," | ";" {
  const tabs = (headerLine.match(/\t/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  const semis = (headerLine.match(/;/g) ?? []).length;
  if (tabs >= commas && tabs >= semis) return "\t";
  return semis > commas ? ";" : ",";
}

/** Split one line honouring double-quoted fields (RFC 4180 style). */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"' && current === "") {
      quoted = true;
    } else if (char === delimiter) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

function uniqueKeys(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = normalizeColumnKey(header || `column_${index + 1}`);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
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
  let headerIndex = 0;
  while (headerIndex < lines.length) {
    const line = lines[headerIndex];
    if (line.trim() === "" || (skipPrefix && line.startsWith(skipPrefix))) {
      headerIndex += 1;
      continue;
    }
    break;
  }
  if (headerIndex >= lines.length) {
    return { columns: [], rows: [], truncated: false, delimiter: "\t" };
  }
  const delimiter =
    !options.delimiter || options.delimiter === "auto" ? detectDelimiter(lines[headerIndex]) : options.delimiter;
  const columns = uniqueKeys(splitLine(lines[headerIndex], delimiter).map((header) => header.trim()));
  const rows: ExploreRowData[] = [];
  let truncated = false;
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") continue;
    if (skipPrefix && line.startsWith(skipPrefix)) continue;
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    const cells = splitLine(line, delimiter);
    const row: ExploreRowData = {};
    columns.forEach((column, columnIndex) => {
      row[column] = coerceCell(cells[columnIndex] ?? null);
    });
    rows.push(row);
  }
  return { columns, rows, truncated, delimiter };
}
