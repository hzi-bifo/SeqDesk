import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("./datasets", () => ({ fetchDatasetRows: async () => ({ rows: [], nextCursor: null, total: 0 }) }));

import type { ExploreDatasetVersion } from "@prisma/client";
import { clearTableQueryCache, readTablePage } from "./table-page";
import { openTableDownload } from "./table-download";
import { QueryInputError } from "./table-query";

let dir = "";
let version: ExploreDatasetVersion;
const ROWS = 40;

const collect = async (body: AsyncIterable<string | Buffer>) => { let text = ""; for await (const chunk of body) text += chunk.toString(); return text; };

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "table-page-"));
  const lines = ["sample\tscore\tgroup"];
  const offsets: number[] = [];
  let offset = Buffer.byteLength(lines[0]) + 1;
  for (let i = 0; i < ROWS; i += 1) {
    if (i % 10 === 0) offsets.push(offset);
    const line = [`S${i}`, i % 9 === 4 ? "" : String((i * 13) % 50), i % 2 ? "b, \"quoted\"" : "a"].join("\t");
    lines.push(line);
    offset += Buffer.byteLength(line) + 1;
  }
  await fs.writeFile(path.join(dir, "data.tsv"), `${lines.join("\n")}\n`);
  await fs.writeFile(path.join(dir, "rows.idx.json"), JSON.stringify({ every: 10, offsets, rows: ROWS }));
  version = {
    id: "v1", datasetId: "d1", number: 1, contentHash: "h", rowCount: ROWS, storagePath: dir, buildSource: "import", createdById: null, createdAt: new Date(),
    schema: JSON.stringify({ columns: [{ key: "sample", label: "sample", type: "string" }, { key: "score", label: "score", type: "number" }, { key: "group", label: "group", type: "string" }] }),
    provenance: JSON.stringify({ storage: { rows: "file", index: "rows.idx.json" } }),
  } as unknown as ExploreDatasetVersion;
});
afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe("table pages with a sort, a filter or a search", () => {
  it("sorts by a number across every row and pages by offset", async () => {
    clearTableQueryCache();
    const first = await readTablePage(version, [], { limit: 10, sort: "score:desc" });
    const scores = first.body.rows.map((row) => Number(row.score));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(first.body.view).toMatchObject({ complete: true, scanned: ROWS, sort: [{ column: "score", dir: "desc" }] });
    expect(first.body.nextCursor).toBe("o10");
    const second = await readTablePage(version, [], { limit: 10, sort: "score:desc", cursor: first.body.nextCursor });
    expect(Number(second.body.rows[0].score)).toBeLessThanOrEqual(scores[scores.length - 1]);
    expect(second.body.rows.some((row) => first.body.rows.some((other) => other.sample === row.sample))).toBe(false);
    // Blank scores come last.
    const all = await readTablePage(version, [], { limit: 100, sort: "score:asc" });
    const last = all.body.rows[all.body.rows.length - 1];
    expect(last.score).toBeNull();
    expect(all.body.nextCursor).toBeNull();
  });
  it("filters on a typed condition and counts what matched", async () => {
    const page = await readTablePage(version, [], { limit: 100, filters: JSON.stringify([{ column: "score", op: "gt", value: "40" }]) });
    expect(page.body.rows.length).toBeGreaterThan(0);
    expect(page.body.rows.every((row) => Number(row.score) > 40)).toBe(true);
    expect(page.body.view).toMatchObject({ complete: true, matched: page.body.rows.length, scanned: ROWS });
  });
  it("searches every row, continues by cursor and says how far it read", async () => {
    const first = await readTablePage(version, [], { limit: 5, search: "quoted" });
    expect(first.body.rows).toHaveLength(5);
    expect(first.body.truncated).toBe(true);
    expect(first.body.search).toMatchObject({ query: "quoted", complete: false });
    const next = await readTablePage(version, [], { limit: 50, search: "quoted", cursor: first.body.nextCursor });
    expect(next.body.rows.length + 5).toBe(ROWS / 2);
    expect(next.body.view?.complete).toBe(true);
  });
  it("hands back a partial scan with a cursor when the budget ends", async () => {
    const page = await readTablePage(version, [], { limit: 10, search: "nomatch", budgetMs: -1 });
    expect(page.body.rows).toHaveLength(0);
    expect(page.body.view?.stopped).toBe("end");
  });
  it("refuses an unknown column with a sentence", async () => {
    await expect(readTablePage(version, [], { limit: 10, sort: "nope" })).rejects.toBeInstanceOf(QueryInputError);
  });
  it("leaves the plain page as it was", async () => {
    // No search, sort or filter: the page comes from the row store (mocked empty here) and carries no view.
    const page = await readTablePage(version, [], { limit: 5 });
    expect(page.body.view).toBeNull();
    expect(page.body.search).toBeNull();
    expect(page.body.total).toBe(ROWS);
  });
});

describe("table downloads", () => {
  it("serves the stored file for the whole table", async () => {
    const download = await openTableDownload(version, [], { format: "tsv" });
    const text = await collect(download.body);
    expect(text).toBe(await fs.readFile(path.join(dir, "data.tsv"), "utf8"));
    expect(download).toMatchObject({ rows: ROWS, limited: null, extension: "tsv" });
  });
  it("writes only the rows of a filtered view, csv-quoted", async () => {
    const download = await openTableDownload(version, [], { format: "csv", filters: JSON.stringify([{ column: "group", op: "contains", value: "quoted" }]) });
    const text = await collect(download.body);
    const lines = text.trim().split("\n");
    expect(lines[0]).toBe("sample,score,group");
    expect(lines).toHaveLength(1 + ROWS / 2);
    expect(lines[1]).toContain('"b, ""quoted"""');
  });
  it("writes a sorted view in order and only the chosen columns", async () => {
    const download = await openTableDownload(version, [], { format: "tsv", sort: "score:asc", columns: "sample,score" });
    const lines = (await collect(download.body)).trim().split("\n");
    expect(lines[0]).toBe("sample\tscore");
    const scores = lines.slice(1).map((line) => line.split("\t")[1]).filter((value) => value !== "").map(Number);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    expect(download.rows).toBe(ROWS);
  });
});
