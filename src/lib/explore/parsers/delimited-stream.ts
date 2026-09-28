/**
 * Streaming counterpart of parseDelimited: the same header rules (preamble, "#" headers, R row names, quoted
 * newlines, strict field counts), read line by line from a byte stream so a file of any size is parsed with
 * memory bounded by one record plus a few lines of lookahead.
 */
import { StringDecoder } from "string_decoder";
import { coerceCell } from "../schema";
import type { ExploreRowData } from "../types";
import { DelimitedParseError, detectDelimiter, splitLine, uniqueColumnKeys, type DelimitedParseOptions } from "./delimited";

/** Lines of a byte stream split on \n with a trailing \r removed, as text.split(/\r?\n/) does (including the final empty line). */
export async function* streamLines(source: AsyncIterable<Buffer | string>): AsyncGenerator<string> {
  const decoder = new StringDecoder("utf8");
  let rest = "";
  for await (const chunk of source) {
    rest += typeof chunk === "string" ? chunk : decoder.write(chunk);
    let start = 0;
    for (let at = rest.indexOf("\n"); at >= 0; at = rest.indexOf("\n", start)) {
      const line = rest.slice(start, at);
      yield line.endsWith("\r") ? line.slice(0, -1) : line;
      start = at + 1;
    }
    rest = rest.slice(start);
  }
  rest += decoder.end();
  yield rest.endsWith("\r") ? rest.slice(0, -1) : rest;
}

/** Random access to lines near the read position; lines before `release` are dropped. */
class LineWindow {
  private lines: string[] = [];
  private base = 0;
  private done = false;
  constructor(private source: AsyncIterator<string>) {}
  async at(index: number): Promise<string | undefined> {
    while (!this.done && index >= this.base + this.lines.length) {
      const next = await this.source.next();
      if (next.done) this.done = true;
      else this.lines.push(next.value);
    }
    return index - this.base < this.lines.length ? this.lines[index - this.base] : undefined;
  }
  release(index: number) {
    if (index <= this.base) return;
    this.lines.splice(0, Math.min(index - this.base, this.lines.length));
    this.base = index;
  }
}

export interface DelimitedStreamHeader {
  columns: string[];
  delimiter: string;
}

/**
 * Parse delimited records from lines. `onHeader` is called once with the columns before the first row is
 * yielded; the rows are the same objects parseDelimited returns. `maxRows` stops early (the caller sees
 * `truncated` through `state`).
 */
export async function* parseDelimitedStream(
  source: AsyncIterable<string>,
  options: DelimitedParseOptions = {},
  state: { header?: DelimitedStreamHeader; truncated?: boolean } = {},
): AsyncGenerator<ExploreRowData> {
  const window = new LineWindow(source[Symbol.asyncIterator]());
  const skipPrefix = options.skipLinesStartingWith;
  let headerIndex = 0;
  if (options.headerLinePrefix) {
    for (;;) {
      const line = await window.at(headerIndex);
      if (line === undefined) throw new Error("Declared table header was not found");
      if (line.startsWith(options.headerLinePrefix)) break;
      headerIndex += 1;
    }
  }
  for (;;) {
    const line = await window.at(headerIndex);
    if (line === undefined) break;
    if (options.headerLinePrefix && line.startsWith(options.headerLinePrefix)) break;
    if (line.trim() === "" || (skipPrefix && line.startsWith(skipPrefix))) { headerIndex += 1; continue; }
    break;
  }
  if ((await window.at(headerIndex)) === undefined) {
    state.header = { columns: [], delimiter: "\t" };
    return;
  }
  if (options.hashComments && !options.headerLinePrefix) {
    const fields = (line: string) => line.split(detectDelimiter(line)).length;
    while ((await window.at(headerIndex))?.startsWith("#")) {
      let next = headerIndex + 1;
      while ((await window.at(next)) !== undefined && (await window.at(next))!.trim() === "") next += 1;
      const nextLine = await window.at(next);
      if (nextLine === undefined || fields((await window.at(headerIndex))!) >= fields(nextLine)) break;
      headerIndex = next;
    }
  }
  const header = (await window.at(headerIndex))!.slice(options.headerLinePrefix?.length ?? 0);
  const skipped = (line: string) => line.trim() === "" || Boolean(skipPrefix && line.startsWith(skipPrefix)) || Boolean(options.hashComments && line.startsWith("#"));
  const delimiter = !options.delimiter || options.delimiter === "auto" ? detectDelimiter(header) : options.delimiter;
  const recordAt = async (start: number, initial?: string) => {
    let line = initial ?? (await window.at(start))!;
    let end = start;
    let cells = splitLine(line, delimiter);
    while (cells === null) {
      end += 1;
      const more = await window.at(end);
      if (more === undefined) throw new DelimitedParseError(`Unclosed quoted field starting on line ${start + 1}`);
      line += "\n" + more;
      cells = splitLine(line, delimiter);
    }
    return { cells, end };
  };
  const headerRecord = await recordAt(headerIndex, header);
  headerIndex = headerRecord.end;
  let columns = uniqueColumnKeys(headerRecord.cells.map((cell) => cell.trim()));
  const widths: number[] = [];
  for (let index = headerIndex + 1; (await window.at(index)) !== undefined && widths.length < 3; index += 1) {
    if (skipped((await window.at(index))!)) continue;
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
  for (let index = headerIndex + 1; ; index += 1) {
    window.release(index);
    const line = await window.at(index);
    if (line === undefined) break;
    if (skipped(line)) continue;
    if (count >= maxRows) { state.truncated = true; break; }
    const record = await recordAt(index);
    const cells = record.cells;
    if (cells.length > columns.length) throw new DelimitedParseError(`Line ${index + 1} has more fields than the header`);
    index = record.end;
    const row: ExploreRowData = {};
    for (let column = 0; column < columns.length; column += 1) row[columns[column]] = coerceCell(cells[column] ?? null);
    count += 1;
    yield row;
  }
}
