import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QueryInputError, isMissingCell, compileQuery, emptyQuery, numberOf, parseFilters, parseSort, readLayout, rowRecord, scanMatching, scanSorted, type FileLayout } from "./table-query";
import type { ExploreColumn } from "./types";

const columns: ExploreColumn[] = [
  { key: "id", label: "id", type: "string" },
  { key: "gene", label: "gene", type: "string" },
  { key: "count", label: "count", type: "number" },
  { key: "note", label: "note", type: "string" },
];
const genes = ["WASH7P", "OR4F5", "CICP27", "Ünïcode", "İstanbul"];
let dir = "";
let plainDir = "";
let layout: FileLayout;
let plain: FileLayout;
const ROWS = 50;

async function makeTable(where: string, names: string[]): Promise<FileLayout> {
  const lines = ["id\tgene\tcount\tnote"];
  const offsets: number[] = [];
  let offset = Buffer.byteLength(lines[0]) + 1;
  for (let i = 0; i < ROWS; i += 1) {
    if (i % 7 === 0) offsets.push(offset);
    const line = [`r${i}`, names[i % names.length], i % 10 === 3 ? "" : String((i * 37) % 101), i % 6 === 0 ? "needle here" : "plain"].join("\t");
    lines.push(line);
    offset += Buffer.byteLength(line) + 1;
  }
  await fs.writeFile(path.join(where, "data.tsv"), `${lines.join("\n")}\n`);
  await fs.writeFile(path.join(where, "rows.idx.json"), JSON.stringify({ every: 7, offsets, rows: ROWS }));
  return (await readLayout(where))!;
}

beforeAll(async () => {
  // One table with letters whose lower case has another length (its chunk is read line by line), one without (the raw path).
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "table-query-"));
  plainDir = await fs.mkdtemp(path.join(os.tmpdir(), "table-query-plain-"));
  layout = await makeTable(dir, genes);
  plain = await makeTable(plainDir, genes.filter((name) => name !== "İstanbul"));
});
afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); await fs.rm(plainDir, { recursive: true, force: true }); });

const compile = (query: Partial<ReturnType<typeof emptyQuery>>) => compileQuery(layout.header, columns, { ...emptyQuery(), ...query });
const opts = { limit: 0, budgetMs: 10_000 };

describe("parsing", () => {
  it("reads sort keys and refuses unknown columns or three keys", () => {
    expect(parseSort("count:desc,gene", columns)).toEqual([{ column: "count", dir: "desc" }, { column: "gene", dir: "asc" }]);
    expect(() => parseSort("nope:asc", columns)).toThrow(QueryInputError);
    expect(() => parseSort("id,gene,count", columns)).toThrow(/at most 2/);
  });
  it("reads filters and refuses a missing value or an unknown condition", () => {
    expect(parseFilters('[{"column":"count","op":"gt","value":"50"},{"column":"note","op":"empty"}]', columns)).toHaveLength(2);
    expect(() => parseFilters('[{"column":"count","op":"gt"}]', columns)).toThrow(/needs a value/);
    expect(() => parseFilters('[{"column":"count","op":"like","value":"1"}]', columns)).toThrow(/Unknown filter/);
    expect(() => parseFilters("{", columns)).toThrow(/not valid JSON/);
  });
  it("reads numbers the way people write them", () => {
    expect(numberOf("1,5")).toBe(1.5);
    expect(numberOf("-2e3")).toBe(-2000);
    expect(numberOf("12abc")).toBeNull();
    expect(numberOf("")).toBeNull();
  });
});

describe("layout", () => {
  it("finds the header and the row index", () => {
    expect(layout.header).toEqual(["id", "gene", "count", "note"]);
    expect(layout.index?.rows).toBe(ROWS);
  });
});

describe.each([["raw path", () => [plainDir, plain] as const], ["line path", () => [dir, layout] as const]])("search (%s)", (_name, pick) => {
  const compileFor = (query: Partial<ReturnType<typeof emptyQuery>>) => compileQuery(pick()[1].header, columns, { ...emptyQuery(), ...query });
  const scan = (query: Partial<ReturnType<typeof emptyQuery>>, options: Parameters<typeof scanMatching>[3]) => scanMatching(pick()[0], pick()[1], compileFor(query), options);
  it("finds rows by any cell, ignoring case, with their row index", async () => {
    const result = await scan({ search: "NEEDLE" }, opts);
    expect(result.rows.map((row) => row.rowIndex)).toEqual([0, 6, 12, 18, 24, 30, 36, 42, 48]);
    expect(result.end).toBe(true);
    expect(result.scanned).toBe(ROWS);
  });
  it("stops at the limit and continues after the last row read", async () => {
    const first = await scan({ search: "needle" }, { ...opts, limit: 3 });
    expect(first.rows.map((row) => row.rowIndex)).toEqual([0, 6, 12]);
    expect(first.end).toBe(false);
    const next = await scan({ search: "needle" }, { ...opts, limit: 3, start: first.rows[2].rowIndex + 1 });
    expect(next.rows.map((row) => row.rowIndex)).toEqual([18, 24, 30]);
  });
  it("starts in the middle of an index block", async () => {
    const result = await scan({ search: "needle" }, { ...opts, start: 13 });
    expect(result.rows[0].rowIndex).toBe(18);
  });
  it("ignores tabs and spaces around the needle", async () => {
    const bare = await scan({ search: "wash7p" }, opts);
    expect(bare.rows.length).toBeGreaterThan(5);
    expect((await scan({ search: " wash7p\t" }, opts)).rows.map((row) => row.rowIndex)).toEqual(bare.rows.map((row) => row.rowIndex));
  });
  it("finds a cell with a non-ASCII letter", async () => {
    const result = await scan({ search: "ünïcode" }, opts);
    expect(result.rows.every((row) => row.cells[1] === "Ünïcode")).toBe(true);
    expect(result.rows.length).toBeGreaterThan(5);
  });
  it("stops when the budget is spent and says where it got to", async () => {
    const result = await scan({ search: "zzz" }, { ...opts, budgetMs: -1, chunkBytes: 64 });
    expect(result.end).toBe(false);
    expect(result.stopped).toBe("budget");
    expect(result.lastIndex).not.toBeNull();
  });
  it("stops when the caller hangs up", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await scan({ search: "zzz" }, { ...opts, signal: controller.signal });
    expect(result.stopped).toBe("aborted");
  });
});

describe("filters", () => {
  it("compares numbers as numbers", async () => {
    const result = await scanMatching(dir, layout, compile({ filters: [{ column: "count", op: "gt", value: "9" }] }), opts);
    const counts = result.rows.map((row) => Number(row.cells[2]));
    expect(counts.length).toBeGreaterThan(0);
    expect(counts.every((value) => value > 9)).toBe(true);
    // "9" is greater than "10" as text: a text comparison would have missed these.
    expect(counts.some((value) => value >= 10)).toBe(true);
  });
  it("keeps equals, contains and empty apart", async () => {
    expect((await scanMatching(dir, layout, compile({ filters: [{ column: "gene", op: "eq", value: "or4f5" }] }), opts)).rows.length).toBe(10);
    expect((await scanMatching(dir, layout, compile({ filters: [{ column: "gene", op: "contains", value: "ash" }] }), opts)).rows.length).toBe(10);
    const empty = await scanMatching(dir, layout, compile({ filters: [{ column: "count", op: "empty" }] }), opts);
    expect(empty.rows.every((row) => row.cells[2] === "")).toBe(true);
    expect(empty.rows.length).toBe(5);
    const notEmpty = await scanMatching(dir, layout, compile({ filters: [{ column: "count", op: "notempty" }] }), opts);
    expect(notEmpty.rows.length).toBe(ROWS - 5);
  });
  it("combines filters and a search", async () => {
    const result = await scanMatching(dir, layout, compile({ search: "needle", filters: [{ column: "gene", op: "eq", value: "WASH7P" }] }), opts);
    expect(result.rows.every((row) => row.cells[1] === "WASH7P" && row.cells[3] === "needle here")).toBe(true);
  });
});

describe("sort", () => {
  it("orders numbers as numbers with blanks last, either way", async () => {
    const asc = await scanSorted(dir, layout, compile({ sort: [{ column: "count", dir: "asc" }] }), { ...opts, keep: ROWS });
    const values = asc.rows.map((row) => row.cells[2]);
    const numeric = values.filter((value) => value !== "").map(Number);
    expect(numeric).toEqual([...numeric].sort((a, b) => a - b));
    expect(values.slice(-5).every((value) => value === "")).toBe(true);
    const desc = await scanSorted(dir, layout, compile({ sort: [{ column: "count", dir: "desc" }] }), { ...opts, keep: ROWS });
    expect(desc.rows.slice(-5).every((row) => row.cells[2] === "")).toBe(true);
    expect(Number(desc.rows[0].cells[2])).toBe(Math.max(...numeric));
  });
  it("sorts by two columns", async () => {
    const result = await scanSorted(dir, layout, compile({ sort: [{ column: "gene", dir: "asc" }, { column: "count", dir: "desc" }] }), { ...opts, keep: ROWS });
    const first = result.rows.filter((row) => row.cells[1] === "CICP27").map((row) => Number(row.cells[2])).filter((value) => !Number.isNaN(value) && value === value);
    expect(first).toEqual([...first].sort((a, b) => b - a));
  });
  it("keeps only the best rows and still counts every match", async () => {
    const result = await scanSorted(dir, layout, compile({ sort: [{ column: "count", dir: "desc" }], filters: [{ column: "count", op: "notempty" }] }), { ...opts, keep: 4 });
    expect(result.rows).toHaveLength(4);
    expect(result.matched).toBe(ROWS - 5);
    expect(result.end).toBe(true);
    expect(result.scanned).toBe(ROWS);
  });
  it("reports a partial sort when the budget ends", async () => {
    const result = await scanSorted(dir, layout, compile({ sort: [{ column: "count", dir: "asc" }] }), { ...opts, budgetMs: -1, keep: 5, chunkBytes: 64 });
    expect(result.end).toBe(false);
  });
});

describe("messy cells", () => {
  it("counts NA, null and a dash as missing", () => {
    for (const cell of ["", " ", "NA", "n/a", "#N/A", "NaN", "null", "None", "-"]) expect(isMissingCell(cell)).toBe(true);
    for (const cell of ["0", "NAN0", "-1", "nullable"]) expect(isMissingCell(cell)).toBe(false);
  });
  it("sorts numbers, then text, then missing values, in either direction", () => {
    const sortBy = (dir: "asc" | "desc") => {
      const compiled = compileQuery(["v"], [{ key: "v", label: "v", type: "string" }], { ...emptyQuery(), sort: [{ column: "v", dir }] });
      return ["b", "NA", "10", "a", "2", "null", "-5"].map((cell, rowIndex) => ({ rowIndex, key: compiled.sortKey([cell]), cell })).sort(compiled.compare).map((row) => row.cell);
    };
    expect(sortBy("asc")).toEqual(["-5", "2", "10", "a", "b", "NA", "null"]);
    expect(sortBy("desc")).toEqual(["10", "2", "-5", "b", "a", "NA", "null"]);
  });
});
