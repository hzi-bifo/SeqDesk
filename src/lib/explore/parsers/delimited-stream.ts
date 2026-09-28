/**
 * Streaming counterpart of parseDelimited: the same header rules (preamble, "#" headers, R row names, quoted
 * newlines, strict field counts), read line by line from a byte stream so a file of any size is parsed with
 * memory bounded by one record plus a few lines of lookahead.
 */
import { StringDecoder } from "string_decoder";
import { coerceCell } from "../schema";
import type { ExploreRowData } from "../types";
import { DelimitedParseError, detectDelimiter, splitLine, uniqueColumnKeys, type DelimitedParseOptions } from "./delimited";

/**
 * Lines of a byte stream split on \n with a trailing \r removed, as text.split(/\r?\n/) does (including the final
 * empty line), handed over one chunk's lines at a time: a promise per chunk, not per line (a table of 20 million
 * rows would otherwise make 20 million promises, which also overflows the dev server's async tracking).
 */
export async function* streamLineBatches(source: AsyncIterable<Buffer | string>): AsyncGenerator<string[]> {
  const decoder = new StringDecoder("utf8");
  let rest = "";
  for await (const chunk of source) {
    rest += typeof chunk === "string" ? chunk : decoder.write(chunk);
    const lines: string[] = [];
    let start = 0;
    for (let at = rest.indexOf("\n"); at >= 0; at = rest.indexOf("\n", start)) {
      const line = rest.slice(start, at);
      lines.push(line.endsWith("\r") ? line.slice(0, -1) : line);
      start = at + 1;
    }
    rest = rest.slice(start);
    if (lines.length) yield lines;
  }
  rest += decoder.end();
  yield [rest.endsWith("\r") ? rest.slice(0, -1) : rest];
}

/** Line by line (tests and small inputs); large readers use streamLineBatches. */
export async function* streamLines(source: AsyncIterable<Buffer | string>): AsyncGenerator<string> {
  for await (const batch of streamLineBatches(source)) yield* batch;
}

/** Random access to lines near the read position; lines before `release` are dropped. Reads are synchronous once `ensure` has loaded them. */
class LineWindow {
  private lines: string[] = [];
  private base = 0;
  done = false;
  constructor(private source: AsyncIterator<string[]>) {}
  has(index: number): boolean {
    return index - this.base < this.lines.length;
  }
  /** Load batches until `index` is buffered or the input ended. */
  async ensure(index: number): Promise<void> {
    while (!this.done && !this.has(index)) {
      const next = await this.source.next();
      if (next.done) this.done = true;
      else for (const line of next.value) this.lines.push(line);
    }
  }
  at(index: number): string | undefined {
    return this.has(index) ? this.lines[index - this.base] : undefined;
  }
  release(index: number) {
    // Dropping lines is a copy; do it in bulk, not per line.
    if (index - this.base < 65_536) return;
    this.lines = this.lines.slice(index - this.base);
    this.base = index;
  }
}

export interface DelimitedStreamHeader {
  columns: string[];
  delimiter: string;
}

/**
 * Parse delimited records from line batches. `state.header` is set before the first rows are yielded; rows come in
 * batches (the same objects parseDelimited returns). `maxRows` stops early and sets `state.truncated`.
 */
export async function* parseDelimitedStream(
  source: AsyncIterable<string[]>,
  options: DelimitedParseOptions = {},
  state: { header?: DelimitedStreamHeader; truncated?: boolean } = {},
  batchSize = 1000,
): AsyncGenerator<ExploreRowData[]> {
  const window = new LineWindow(source[Symbol.asyncIterator]());
  // Every line read goes through here: an await only when the line is not buffered yet.
  const line = async (index: number) => { if (!window.has(index) && !window.done) await window.ensure(index); return window.at(index); };
  const skipPrefix = options.skipLinesStartingWith;
  let headerIndex = 0;
  if (options.headerLinePrefix) {
    for (;;) {
      const text = await line(headerIndex);
      if (text === undefined) throw new Error("Declared table header was not found");
      if (text.startsWith(options.headerLinePrefix)) break;
      headerIndex += 1;
    }
  }
  for (;;) {
    const text = await line(headerIndex);
    if (text === undefined) break;
    if (options.headerLinePrefix && text.startsWith(options.headerLinePrefix)) break;
    if (text.trim() === "" || (skipPrefix && text.startsWith(skipPrefix))) { headerIndex += 1; continue; }
    break;
  }
  if ((await line(headerIndex)) === undefined) {
    state.header = { columns: [], delimiter: "\t" };
    return;
  }
  if (options.hashComments && !options.headerLinePrefix) {
    const fields = (text: string) => text.split(detectDelimiter(text)).length;
    while ((await line(headerIndex))?.startsWith("#")) {
      let next = headerIndex + 1;
      while ((await line(next)) !== undefined && (await line(next))!.trim() === "") next += 1;
      const nextLine = await line(next);
      if (nextLine === undefined || fields((await line(headerIndex))!) >= fields(nextLine)) break;
      headerIndex = next;
    }
  }
  const header = (await line(headerIndex))!.slice(options.headerLinePrefix?.length ?? 0);
  const skipped = (text: string) => text.trim() === "" || Boolean(skipPrefix && text.startsWith(skipPrefix)) || Boolean(options.hashComments && text.startsWith("#"));
  const delimiter = !options.delimiter || options.delimiter === "auto" ? detectDelimiter(header) : options.delimiter;
  const recordAt = async (start: number, initial?: string) => {
    let text = initial ?? (await line(start))!;
    let end = start;
    let cells = splitLine(text, delimiter);
    while (cells === null) {
      end += 1;
      const more = await line(end);
      if (more === undefined) throw new DelimitedParseError(`Unclosed quoted field starting on line ${start + 1}`);
      text += "\n" + more;
      cells = splitLine(text, delimiter);
    }
    return { cells, end };
  };
  const headerRecord = await recordAt(headerIndex, header);
  headerIndex = headerRecord.end;
  let columns = uniqueColumnKeys(headerRecord.cells.map((cell) => cell.trim()));
  const widths: number[] = [];
  for (let index = headerIndex + 1; (await line(index)) !== undefined && widths.length < 3; index += 1) {
    if (skipped((await line(index))!)) continue;
    const record = await recordAt(index);
    widths.push(record.cells.length);
    index = record.end;
  }
  if (widths.length >= 2 && widths.every((width) => width === columns.length + 1)) {
    columns = uniqueColumnKeys(["row_name", ...headerRecord.cells.map((cell) => cell.trim())]);
  }
  state.header = { columns, delimiter };
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
  let count = 0;
  let batch: ExploreRowData[] = [];
  for (let index = headerIndex + 1; ; index += 1) {
    window.release(index);
    if (!window.has(index)) {
      if (batch.length) { yield batch; batch = []; }
      if (!window.done) await window.ensure(index);
    }
    const text = window.at(index);
    if (text === undefined) break;
    if (skipped(text)) continue;
    if (count >= maxRows) { state.truncated = true; break; }
    const first = index;
    let cells = splitLine(text, delimiter);
    if (cells === null) {
      const record = await recordAt(index);
      cells = record.cells;
      index = record.end;
    }
    if (cells.length > columns.length) throw new DelimitedParseError(`Line ${first + 1} has more fields than the header`);
    const row: ExploreRowData = {};
    for (let column = 0; column < columns.length; column += 1) row[columns[column]] = coerceCell(cells[column] ?? null);
    count += 1;
    batch.push(row);
    if (batch.length >= batchSize) { yield batch; batch = []; }
  }
  if (batch.length) yield batch;
}
