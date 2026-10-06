import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileQuery, emptyQuery, readLayout, scanMatching, scanSorted, type FileLayout } from "./table-query";
import type { ExploreColumn } from "./types";

const columns: ExploreColumn[] = [{ key: "id", label: "id", type: "string" }, { key: "note", label: "note", type: "string" }];
let dir = "";
let layout: FileLayout;

// quoted-v1: a cell with a tab, line break or quote is in quotes; rows.fmt marks the file.
const rows = [["r0", "plain"], ["r1", '"two\nlines"'], ["r2", '"a\tb"'], ["r3", '"say ""needle"""'], ["r4", "needle tail"]];

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "quoted-scan-"));
  const header = "id\tnote\n";
  let text = header;
  const offsets: number[] = [];
  for (const [index, row] of rows.entries()) {
    if (index % 2 === 0) offsets.push(Buffer.byteLength(text));
    text += `${row.join("\t")}\n`;
  }
  await fs.writeFile(path.join(dir, "data.tsv"), text);
  await fs.writeFile(path.join(dir, "rows.fmt"), "quoted-v1");
  await fs.writeFile(path.join(dir, "rows.idx.json"), JSON.stringify({ every: 2, offsets, rows: rows.length }));
  layout = (await readLayout(dir))!;
});
afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

const opts = { limit: 0, budgetMs: 10_000 };
const compile = (query: Partial<ReturnType<typeof emptyQuery>>) => compileQuery(layout.header, columns, { ...emptyQuery(), ...query });

describe("scans of a quoted-v1 file", () => {
  it("keep a multi-line cell in one row with its tab and line break intact", async () => {
    const scan = await scanMatching(dir, layout, compile({}), opts);
    expect(scan.rows.map((row) => row.rowIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(scan.rows[1].cells).toEqual(["r1", "two\nlines"]);
    expect(scan.rows[2].cells).toEqual(["r2", "a\tb"]);
    expect(scan.rows[3].cells).toEqual(["r3", 'say "needle"']);
  });
  it("start from an index block that follows a multi-line row", async () => {
    const scan = await scanMatching(dir, layout, compile({}), { ...opts, start: 3 });
    expect(scan.rows.map((row) => row.cells[0])).toEqual(["r3", "r4"]);
  });
  it("search finds a needle in a row that has quotes, and the fast path still counts rows right", async () => {
    const scan = await scanMatching(dir, layout, compile({ search: "needle" }), opts);
    expect(scan.rows.map((row) => [row.rowIndex, row.cells[0]])).toEqual([[3, "r3"], [4, "r4"]]);
  });
  it("sorting reads the same rows", async () => {
    const scan = await scanSorted(dir, layout, compile({ sort: [{ column: "id", dir: "desc" }] }), { ...opts, keep: 10 });
    expect(scan.rows.map((row) => row.cells[0])).toEqual(["r4", "r3", "r2", "r1", "r0"]);
    expect(scan.rows.find((row) => row.cells[0] === "r1")!.cells[1]).toBe("two\nlines");
  });
});
