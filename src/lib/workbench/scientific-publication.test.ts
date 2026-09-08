import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import type { WorkbenchImportResult } from "./importers/types";
import { publishScientificImport, scientificRecordId } from "./scientific-publication";

const result: WorkbenchImportResult = {
  cacheKey: "local-test", name: "local-test", sourceType: "local-fixture", sourceMetadata: {}, storagePath: "/test",
  scientificImport: { targetStudyId: "chosen-study", synthetic: true, studyKey: "dataset", studyTitle: "Dataset", sampleKey: "sample", sampleTitle: "Sample", technology: "long", reads: [{ path: "/test/read.fq.gz", sha256: "digest", bytes: 1 }] },
};

describe("scientific import destination", () => {
  function transaction(study: object | null) {
    return {
      $queryRaw: vi.fn().mockResolvedValue([]),
      order: { upsert: vi.fn().mockResolvedValue({ userId: "owner", dataOrigin: "import" }), update: vi.fn() },
      studySample: { upsert: vi.fn() },
      study: { findFirst: vi.fn().mockResolvedValue(study), upsert: vi.fn() },
      sample: { update: vi.fn(), upsert: vi.fn().mockResolvedValue({ studyId: "chosen-study", orderId: null, sampleTitle: "Sample", customFields: null }) },
      read: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    };
  }
  it("uses an owned editable study without replacing its metadata", async () => {
    const tx = transaction({ id: "chosen-study", userId: "owner", title: "My study" });
    const records = await publishScientificImport(tx as unknown as Prisma.TransactionClient, "owner", result);
    expect(records?.studyId).toBe("chosen-study");
    expect(tx.study.findFirst).toHaveBeenCalledWith({ where: { id: "chosen-study", userId: "owner", user: { isActive: true }, submitted: false } });
    expect(tx.study.upsert).not.toHaveBeenCalled();
    expect(tx.sample.upsert.mock.calls[0][0].create.studyId).toBe("chosen-study");
    expect(tx.read.create.mock.calls[0][0].data).toMatchObject({ dataClass: "unknown", dataClassSource: "external_import", isActive: false });
  });
  it.each([["cleaned", "cleaned"], ["unprocessed", "raw"], ["unknown", "unknown"]] as const)("stores %s declarations with attribution and original evidence", async (state, dataClass) => {
    const tx = transaction({ id: "chosen-study", userId: "owner" });
    await publishScientificImport(tx as unknown as Prisma.TransactionClient, "owner", { ...result, processingDeclaration: { state, details: "Reviewed processing documentation" } });
    const read = tx.read.create.mock.calls[0][0].data;
    expect(read).toMatchObject({ dataClass, dataClassSource: "manual", classifiedById: "owner", isActive: false });
    expect(read.classifiedAt).toBeInstanceOf(Date);
    expect(JSON.parse(read.pipelineSources)).toMatchObject({ sourceType: "local-fixture", synthetic: true, processing: { effectiveState: state, source: { state: "unknown" }, userDeclaration: { state, userId: "owner", details: "Reviewed processing documentation" } } });
  });
  it("rejects a removed, submitted or inaccessible destination before creating records", async () => {
    const tx = transaction(null);
    await expect(publishScientificImport(tx as unknown as Prisma.TransactionClient, "owner", result)).rejects.toThrow("Destination study");
    expect(tx.sample.upsert).not.toHaveBeenCalled();
    expect(tx.read.create).not.toHaveBeenCalled();
  });
  it("persists module-supplied per-read-set processing evidence", async () => {
    const tx = transaction({ id: "chosen-study", userId: "owner" });
    const processing = { state: "cleaned" as const, evidence: "module_documentation" as const, details: "Internal module contract: documented filtering" };
    await publishScientificImport(tx as unknown as Prisma.TransactionClient, "owner", { ...result, scientificImport: { ...result.scientificImport!, processing } });
    const read = tx.read.create.mock.calls[0][0].data;
    expect(read).toMatchObject({ dataClass: "cleaned", dataClassSource: "external_import" });
    expect(JSON.parse(read.pipelineSources).processing).toEqual({ source: processing, effectiveState: "cleaned" });
  });
  it("publishes a named collection with provenance and no SeqDesk study", async () => {
    const tx = transaction(null);
    const collection = { key: "00e55dcb-9697-4b89-af56-af51bd557a17", name: "My controls" };
    const orderId = scientificRecordId("data", "owner", "collection", collection.key);
    tx.sample.upsert.mockResolvedValue({ studyId: null, orderId, sampleTitle: "Sample", customFields: null });
    const records = await publishScientificImport(tx as unknown as Prisma.TransactionClient, "owner", {
      ...result, collection, scientificImport: { ...result.scientificImport!, targetStudyId: undefined, metadata: { originalStudy: { accession: "internal-source-project" } } },
    });
    expect(records).toMatchObject({ orderId, orderTitle: collection.name, studyId: null, studyTitle: null });
    expect(tx.order.upsert.mock.calls[0][0].create).toMatchObject({ name: collection.name, userId: "owner", dataOrigin: "import" });
    expect(tx.sample.upsert.mock.calls[0][0].create).toMatchObject({ orderId, studyId: null });
    expect(JSON.parse(tx.sample.upsert.mock.calls[0][0].create.customFields).originalMetadata.originalStudy.accession).toBe("internal-source-project");
    expect(tx.study.findFirst).not.toHaveBeenCalled();
    expect(tx.study.upsert).not.toHaveBeenCalled();
    expect(tx.studySample.upsert).not.toHaveBeenCalled();
    expect(tx.read.create).toHaveBeenCalledTimes(1);
  });
  it("does not relabel or adopt a collection owned by someone else", async () => {
    const tx = transaction(null);
    tx.order.upsert.mockResolvedValue({ userId: "other-owner", dataOrigin: "import" });
    await expect(publishScientificImport(tx as unknown as Prisma.TransactionClient, "owner", { ...result, scientificImport: { ...result.scientificImport!, targetStudyId: undefined } })).rejects.toThrow("ownership changed");
    expect(tx.sample.upsert).not.toHaveBeenCalled();
    expect(tx.order.upsert.mock.calls[0][0].update).toEqual({});
  });
});
