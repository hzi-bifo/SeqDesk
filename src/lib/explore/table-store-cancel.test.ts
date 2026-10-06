import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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


beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "table-store-cancel-")); });
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

const provenance = { builtAt: "", builder: "t", sources: [] };

describe("a cancelled write never becomes a version", () => {
  it("rejects an already-cancelled write of a small table", async () => {
    const { writeDatasetVersionStream, ImportCancelled } = await import("./table-store");
    datasets.set("small", { id: "small", currentVersionId: null });
    const controller = new AbortController();
    controller.abort();
    async function* one() { yield [{ id: "1" }]; }
    await expect(writeDatasetVersionStream({ datasetId: "small", columns: ["id"], rows: one(), provenance, buildSource: "import", signal: controller.signal })).rejects.toBeInstanceOf(ImportCancelled);
    expect([...versions.values()].some((version) => version.datasetId === "small")).toBe(false);
    expect(datasets.get("small")!.currentVersionId).toBeNull();
  });

  it("rejects a write cancelled after its last progress check", async () => {
    const { writeDatasetVersionStream, ImportCancelled } = await import("./table-store");
    datasets.set("late", { id: "late", currentVersionId: null });
    const controller = new AbortController();
    async function* rows() { yield [{ id: "1" }, { id: "2" }]; controller.abort(); yield [{ id: "3" }]; }
    await expect(writeDatasetVersionStream({ datasetId: "late", columns: ["id"], rows: rows(), provenance, buildSource: "import", signal: controller.signal })).rejects.toBeInstanceOf(ImportCancelled);
    expect([...versions.values()].some((version) => version.datasetId === "late")).toBe(false);
    expect(datasets.get("late")!.currentVersionId).toBeNull();
  });
});
