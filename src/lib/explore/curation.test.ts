import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { exploreCurationList: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));

import { applyCurationSeed, listCurationForViews, listCurationSeeds, upsertCurationList, validateCurationList } from "./curation";

describe("explore curation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.exploreCurationList.upsert.mockResolvedValue({});
  });

  it("validates list shapes", () => {
    expect(validateCurationList({ listId: "Bad Id", label: "x", role: "pathogen", entries: [] })).toMatch(/listId/);
    expect(validateCurationList({ listId: "ok", label: "", role: "pathogen", entries: [] })).toMatch(/label/);
    expect(validateCurationList({ listId: "ok", label: "x", role: "nope" as never, entries: [] })).toMatch(/role/);
    expect(validateCurationList({ listId: "ok", label: "x", role: "flora", color: "red", entries: [] })).toMatch(/color/);
    expect(validateCurationList({ listId: "ok", label: "x", role: "artifact", entries: [{ name: "a" }] })).toBeNull();
  });

  it("upserts lists with a version bump and trimmed entries", async () => {
    await upsertCurationList("study:s1", { listId: "artifacts", label: "Artifacts", role: "artifact", entries: [{ name: " Toxoplasma gondii ", note: "cross-mapping" }] });
    const call = mocks.db.exploreCurationList.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ targetKey_listId: { targetKey: "study:s1", listId: "artifacts" } });
    expect(call.update.version).toEqual({ increment: 1 });
    expect(JSON.parse(call.create.entries)).toEqual([{ name: "Toxoplasma gondii", note: "cross-mapping" }]);
  });

  it("returns plain name lists for views and accepts legacy string entries", async () => {
    mocks.db.exploreCurationList.findMany.mockResolvedValue([
      { listId: "a", label: "A", role: "pathogen", site: "Urine", tier: "verified", color: null, entries: JSON.stringify(["E. coli", { name: "K. pneumoniae" }]), version: 2, updatedAt: new Date() },
    ]);
    const lists = await listCurationForViews("study:s1");
    expect(lists[0].entries).toEqual(["E. coli", "K. pneumoniae"]);
  });

  it("ships the clinical metagenomics seed and applies every list", async () => {
    const seeds = await listCurationSeeds();
    expect(seeds.map((seed) => seed.seedId)).toContain("clinical-metagenomics");
    const applied = await applyCurationSeed("study:s1", "clinical-metagenomics");
    expect(applied).toBe(8);
    const ids = mocks.db.exploreCurationList.upsert.mock.calls.map((call) => call[0].where.targetKey_listId.listId);
    expect(ids).toContain("urine_verified");
    expect(ids).toContain("artifacts");
    await expect(applyCurationSeed("study:s1", "../etc")).rejects.toThrow(/Invalid seed id/);
  });
});
