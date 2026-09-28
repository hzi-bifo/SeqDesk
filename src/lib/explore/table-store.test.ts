import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { computeContentHash, ContentHashAccumulator, inferSchema, SchemaAccumulator } from "./schema";

let root = "";
type Version = { id: string; datasetId: string; number: number; contentHash: string; schema: string; rowCount: number; provenance: string; storagePath: string | null };
const versions = new Map<string, Version>();
const datasets = new Map<string, { id: string; currentVersionId: string | null }>();
const rows: Array<{ versionId: string }> = [];
let nextId = 0;

vi.mock("@/lib/db", () => ({
  db: {
    exploreDataset: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const dataset = datasets.get(where.id);
        if (!dataset) return null;
        const own = [...versions.values()].filter((version) => version.datasetId === dataset.id).sort((a, b) => b.number - a.number);
        return { ...dataset, versions: own.slice(0, 1) };
      },
      update: async ({ where, data }: { where: { id: string }; data: { currentVersionId: string } }) => Object.assign(datasets.get(where.id)!, data),
    },
    exploreDatasetVersion: {
      create: async ({ data }: { data: Omit<Version, "id"> }) => { const version = { ...data, id: `v${++nextId}` }; versions.set(version.id, version); return version; },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Version> }) => Object.assign(versions.get(where.id)!, data),
      delete: async ({ where }: { where: { id: string } }) => { versions.delete(where.id); for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].versionId === where.id) rows.splice(i, 1); },
      findMany: async ({ where }: { where: { contentHash: string; id: { not: string } } }) => [...versions.values()].filter((version) => version.contentHash === where.contentHash && version.id !== where.id.not),
    },
    exploreDatasetRow: {
      createMany: async ({ data }: { data: Array<{ versionId: string }> }) => { rows.push(...data); },
      deleteMany: async ({ where }: { where: { versionId: string } }) => { for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].versionId === where.versionId) rows.splice(i, 1); },
    },
  },
}));
vi.mock("./storage", () => ({
  resolveExploreStorage: async () => ({ datasetsRoot: root }),
  sanitizeSegment: (value: string) => value,
}));

async function* generate(count: number, width = 3) {
  let batch: Array<Record<string, string | null>> = [];
  for (let index = 0; index < count; index += 1) {
    const row: Record<string, string | null> = { gene: `g${index}` };
    for (let column = 1; column < width; column += 1) row[`s${column}`] = String((index * column) % 97);
    batch.push(row);
    if (batch.length === 999) { yield batch; batch = []; }
  }
  if (batch.length) yield batch;
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "table-store-"));
  vi.stubEnv("SEQDESK_TABLE_DB_MAX_CELLS", "30000");
});
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe("streamed accumulators", () => {
  const sample = [{ a: "1", b: "x", c: "true" }, { a: "2.5", b: null, c: "false" }, { a: null, b: "2026-01-01", c: "1" }];
  it("types columns like inferSchema", () => {
    const accumulator = new SchemaAccumulator();
    for (const row of sample) accumulator.add(row);
    expect(accumulator.schema()).toEqual(inferSchema(sample));
  });
  it("hashes like computeContentHash, and independently of row order above the exact limit", () => {
    const schema = inferSchema(sample);
    const exact = new ContentHashAccumulator();
    for (const row of sample) exact.add(row);
    expect(exact.digest(schema)).toBe(computeContentHash(schema, sample));
    const forward = new ContentHashAccumulator(1);
    const backward = new ContentHashAccumulator(1);
    for (const row of sample) forward.add(row);
    for (const row of [...sample].reverse()) backward.add(row);
    expect(forward.digest(schema)).toMatch(/^m1-/);
    expect(forward.digest(schema)).toBe(backward.digest(schema));
    const changed = new ContentHashAccumulator(1);
    for (const row of [...sample.slice(0, 2), { ...sample[2], a: "3" }]) changed.add(row);
    expect(changed.digest(schema)).not.toBe(forward.digest(schema));
  });
});

describe("writeDatasetVersionStream", () => {
  it("keeps small tables in the database and large ones in the file, with pages read back from the file", async () => {
    const { writeDatasetVersionStream, readRowsFromFile } = await import("./table-store");
    datasets.set("small", { id: "small", currentVersionId: null });
    const small = await writeDatasetVersionStream({ datasetId: "small", columns: ["gene", "s1", "s2", "s3"], rows: generate(100, 4), provenance: { builtAt: "", builder: "t", sources: [] }, buildSource: "import" });
    expect(small.fileBacked).toBe(false);
    expect(rows.filter((row) => row.versionId === small.versionId)).toHaveLength(100);
    expect(small.schema.columns.map((column) => column.type)).toEqual(["string", "number", "number", "number"]);
    expect(small.profile?.verdict).toBe("raw-counts");

    datasets.set("large", { id: "large", currentVersionId: null });
    const progress: number[] = [];
    const large = await writeDatasetVersionStream({ datasetId: "large", columns: ["gene", "s1", "s2"], rows: generate(25_000), provenance: { builtAt: "", builder: "t", sources: [] }, buildSource: "import", onProgress: (count) => progress.push(count) });
    expect(large.fileBacked).toBe(true);
    expect(rows.filter((row) => row.versionId === large.versionId)).toHaveLength(0);
    expect(large.rowCount).toBe(25_000);
    expect(progress.at(-1)).toBe(25_000);
    expect(JSON.parse(versions.get(large.versionId)!.provenance).storage).toEqual({ rows: "file", index: "rows.idx.json" });
    const dir = versions.get(large.versionId)!.storagePath!;
    const page = await readRowsFromFile(dir, ["gene", "s1", "s2"], { start: 21_234, limit: 3 });
    expect(page.rows.map((row) => row.rowIndex)).toEqual([21_234, 21_235, 21_236]);
    expect(page.rows[0].data).toEqual({ gene: "g21234", s1: String(21_234 % 97), s2: String((21_234 * 2) % 97) });
    const tail = await readRowsFromFile(dir, ["gene", "s1", "s2"], { start: 24_998, limit: 10 });
    expect(tail.rows.map((row) => row.rowIndex)).toEqual([24_998, 24_999]);
    expect(tail.end).toBe(true);
    const found = await readRowsFromFile(dir, ["gene", "s1", "s2"], { limit: 2, filter: (row) => row.gene === "g24000" });
    expect(found.rows.map((row) => row.rowIndex)).toEqual([24_000]);
  });

  it("shares the file of an identical version instead of a second copy", async () => {
    const { writeDatasetVersionStream } = await import("./table-store");
    datasets.set("copy", { id: "copy", currentVersionId: null });
    const first = [...versions.values()].find((version) => version.datasetId === "large")!;
    const copy = await writeDatasetVersionStream({ datasetId: "copy", columns: ["gene", "s1", "s2"], rows: generate(25_000), provenance: { builtAt: "", builder: "t", sources: [] }, buildSource: "import" });
    expect(copy.sharedData).toBe(true);
    const [a, b] = await Promise.all([fs.stat(path.join(first.storagePath!, "data.tsv")), fs.stat(path.join(versions.get(copy.versionId)!.storagePath!, "data.tsv"))]);
    expect(a.ino).toBe(b.ino);
  });

  it("removes everything when cancelled", async () => {
    const { writeDatasetVersionStream, ImportCancelled } = await import("./table-store");
    datasets.set("cancel", { id: "cancel", currentVersionId: null });
    const controller = new AbortController();
    controller.abort();
    await expect(writeDatasetVersionStream({ datasetId: "cancel", columns: ["gene", "s1", "s2"], rows: generate(20_000), provenance: { builtAt: "", builder: "t", sources: [] }, buildSource: "import", signal: controller.signal })).rejects.toBeInstanceOf(ImportCancelled);
    expect([...versions.values()].some((version) => version.datasetId === "cancel")).toBe(false);
    await expect(fs.access(path.join(root, "cancel", "v1"))).rejects.toThrow();
  });
});
