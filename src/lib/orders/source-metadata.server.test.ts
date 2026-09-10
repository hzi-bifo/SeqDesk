import { beforeEach, describe, expect, it, vi } from "vitest";
import { scientificRecordId } from "@/lib/workbench/scientific-publication";

const findMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { workbenchImportJob: { findMany } } }));
import { getPendingSourceImports } from "./source-metadata.server";

const collectionKey = "7ff57576-e5b8-4a00-94de-fa12814427de";
const order = {
  id: scientificRecordId("data", "owner", "collection", collectionKey),
  userId: "owner", dataOrigin: "import", sourceMetadata: JSON.stringify({ collectionKey }),
};
const job = {
  id: "job", providerId: "cami-benchmark", status: "running", createdAt: new Date("2026-09-08T10:00:00Z"),
  request: JSON.stringify({ collection: { key: collectionKey }, dataset: "cami2-marine", sample: 0, technology: "short", privateOption: "must-not-be-returned" }),
  preview: JSON.stringify({ summary: { label: "CAMI II Marine sample 0" }, sampleMetadata: { environment: "marine seafloor (simulated)" } }),
};

describe("pending source metadata access", () => {
  beforeEach(() => { vi.clearAllMocks(); findMany.mockResolvedValue([job]); });

  it("scopes the lookup to the authorized collection owner and selects metadata only", async () => {
    const result = await getPendingSourceImports(order);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { createdById: "owner", workspace: { ownerId: "owner" }, request: { contains: collectionKey }, status: { in: ["queued", "running"] } },
      select: { id: true, providerId: true, status: true, request: true, preview: true, createdAt: true },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ providerId: "cami-benchmark", sourceKey: "cami2-marine", metadata: { sourceKey: "sample_0", sampleMetadata: { environment: "marine seafloor (simulated)" } } });
    expect(JSON.stringify(result)).not.toContain("privateOption");
  });

  it("checks exact collection membership after the database substring filter", async () => {
    findMany.mockResolvedValue([{ ...job, request: JSON.stringify({ collection: { key: "another-collection" }, notes: collectionKey }) }, { ...job, request: "invalid" }]);
    expect(await getPendingSourceImports(order)).toEqual([]);
  });

  it.each([
    { ...order, dataOrigin: "facility" },
    { ...order, userId: "another-owner" },
    { ...order, id: "another-record" },
    { ...order, sourceMetadata: "invalid" },
    { ...order, sourceMetadata: null },
  ])("does not look up jobs for inconsistent or absent collection provenance", async value => {
    expect(await getPendingSourceImports(value)).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
