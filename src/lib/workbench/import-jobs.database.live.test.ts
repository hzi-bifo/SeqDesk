import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { prepareBenchmarkReads } from "./prepare-benchmark-reads";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { WorkbenchImportStartContext } from "./importers/types";
import { importCollectionSchema, type ImportCollection } from "./import-collection";
import { processingDeclarationSchema } from "./import-processing";

// Internal worker harness, not an external repository adapter.
vi.mock("@/lib/modules/input-modules.server", () => ({ requireRawReadImporter: vi.fn().mockResolvedValue(undefined) }));

const state = vi.hoisted(() => ({ root: "", starts: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/db", async () => {
  const url = process.env.SEQDESK_IMPORT_TEST_DATABASE_URL;
  if (!url) return { db: null };
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" || !/^\/seqdesk_import_verify_[a-zA-Z0-9_]+$/.test(parsed.pathname)) {
    throw new Error("These tests require an explicitly named disposable local import-test database");
  }
  const { PrismaClient } = await import("@prisma/client");
  return { db: new PrismaClient({ datasourceUrl: url }) };
});
vi.mock("./importers/registry", async () => ({
  getWorkbenchImporter: (({ camiBenchmarkImporter }) => (id: string) => id === "cami-benchmark" ? camiBenchmarkImporter : ({
    id: "local-internal-test", inputSchema: z.object({ selection: z.string(), collection: importCollectionSchema.optional(), processingDeclaration: processingDeclarationSchema.optional() }),
    getCacheKey: () => "same-source-selection", start: state.starts,
  }))(await import("./importers/cami-benchmark")),
}));
vi.mock("@/lib/workbench/analyses", () => ({ updateWorkbenchAnalysisNodeForImportJob: state.notify }));
vi.mock("@/lib/workbench/storage", async (original) => ({
  ...await original<typeof import("./storage")>(),
  resolveWorkbenchImportStorage: async ({ cacheKey, jobId }: { cacheKey: string; jobId: string }) => {
    const cacheDir = path.join(state.root, cacheKey), jobDir = path.join(state.root, jobId);
    await fs.mkdir(cacheDir, { recursive: true }); await fs.mkdir(jobDir, { recursive: true });
    return { cacheDir, jobDir, logPath: path.join(jobDir, "log"), baseDir: state.root, cacheRoot: state.root, jobsRoot: state.root };
  },
}));

import { db } from "@/lib/db";
import { createWorkbenchImportJob, runWorkbenchImportJob, reconcileWorkbenchImports } from "./import-jobs";
import { publishScientificImport, scientificRecordId } from "./scientific-publication";
import { getCamiSampleStatuses } from "./cami-sample-status.server";

const preview = { providerId: "local-internal-test", summary: {
  label: "Local internal data", totalFound: 1, selectedCount: 1, capped: false, cap: 1, hardMax: 1,
}, genomes: [] };
let userId: string;
let collection: ImportCollection;
describe.runIf(Boolean(process.env.SEQDESK_IMPORT_TEST_DATABASE_URL))("isolated real-database import invariants", () => {
  beforeAll(async () => { state.root = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-import-integration-")); });
  afterAll(async () => { await db.$disconnect(); await fs.rm(state.root, { recursive: true, force: true }); });
  beforeEach(async () => {
    await db.workbenchImportJob.deleteMany({ where: { providerId: { in: ["local-internal-test", "cami-benchmark"] } } });
    await db.workbenchDataset.deleteMany({ where: { providerId: "local-internal-test" } });
    state.starts.mockReset(); state.notify.mockReset().mockResolvedValue(undefined);
    const user = await db.user.create({ data: {
      email: `${randomUUID()}@local-test.invalid`, password: "not-a-login-hash", firstName: "Local", lastName: "Test",
    } });
    userId = user.id;
    collection = { key: randomUUID(), name: "Named internal read collection" };
    state.starts.mockImplementation(async (context: WorkbenchImportStartContext<unknown>) => {
      await fs.writeFile(path.join(context.storage.cacheDir, "data.txt"), "internal test data");
      return { cacheKey: context.cacheKey, name: "Local", sourceType: "local-internal-test",
        sourceMetadata: {}, storagePath: context.storage.cacheDir };
    });
  });
  function create(key = randomUUID()) {
    return createWorkbenchImportJob({ userId, providerId: "local-internal-test", input: { selection: "local", collection }, preview, idempotencyKey: key });
  }
  it.each([false, true])("cancels running work and prevents publication even if the provider finishes: %s", async finish => {
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    let cacheDir = "";
    state.starts.mockImplementation(async (context: WorkbenchImportStartContext<unknown>) => {
      cacheDir = context.storage.cacheDir;
      await fs.writeFile(path.join(cacheDir, "partial.txt"), "internal partial file");
      if (finish) {
        await db.workbenchImportJob.update({ where: { id: context.jobId }, data: { phase: "cancelling" } });
        started();
        return { cacheKey: context.cacheKey, name: "Internal", sourceType: "local-internal-test", sourceMetadata: {}, storagePath: cacheDir };
      }
      started();
      await new Promise((_, reject) => context.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    });
    const { job } = await create();
    const running = runWorkbenchImportJob(job.id);
    await ready;
    if (!finish) await db.workbenchImportJob.update({ where: { id: job.id }, data: { phase: "cancelling" } });
    await running;
    expect((await db.workbenchImportJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("cancelled");
    expect(await db.workbenchWorkspaceDataset.count({ where: { createdByImportJobId: job.id } })).toBe(0);
    expect(await db.order.count({ where: { userId } })).toBe(1);
    await expect(fs.stat(cacheDir)).rejects.toThrow();
  });
  it("deduplicates concurrent CAMI selections and reports collection/technology-specific status", async () => {
    // Exercise the real provider input contract and queue, never its external transfer.
    const input = { collection, dataset: "cami2-marine" as const, technology: "long" as const, sample: 0, role: "reads" as const };
    const reviewed = { ...preview, providerId: "cami-benchmark", assets: [] };
    const enqueue = (sample = 0, key = randomUUID()) => createWorkbenchImportJob({ userId, providerId: "cami-benchmark", input: { ...input, sample }, preview: reviewed, idempotencyKey: key });
    const key = randomUUID();
    const sameRequest = await Promise.all(Array.from({ length: 4 }, () => enqueue(0, key)));
    expect(new Set(sameRequest.map(result => result.job.id)).size).toBe(1);
    const duplicates = await Promise.allSettled(Array.from({ length: 4 }, () => enqueue()));
    expect(duplicates.every(result => result.status === "rejected")).toBe(true);
    const distinct = await Promise.allSettled(Array.from({ length: 4 }, () => enqueue(1)));
    expect(distinct.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.workbenchImportJob.count({ where: { createdById: userId, providerId: "cami-benchmark" } })).toBe(2);
    const query = { collection: collection.key, dataset: input.dataset, technology: input.technology };
    expect((await getCamiSampleStatuses(userId, query)).slice(0, 2).map(sample => sample.status)).toEqual(["queued", "queued"]);
    expect((await getCamiSampleStatuses(userId, { ...query, technology: "short" })).every(sample => sample.status === "available")).toBe(true);
    const job = sameRequest[0].job;
    await db.workbenchImportJob.update({ where: { id: job.id }, data: { status: "error", error: "Internal failure" } });
    expect((await getCamiSampleStatuses(userId, query))[0].status).toBe("error");
    const retry = await enqueue(0);
    expect(retry.job.id).not.toBe(job.id);
    expect((await getCamiSampleStatuses(userId, query))[0].status).toBe("queued");
    // Publication fixtures exercise persistent imported state, not external downloads.
    await db.$transaction(tx => publishScientificImport(tx, userId, { collection, cacheKey: "internal-status", name: "Internal", sourceType: "cami-benchmark", sourceMetadata: {}, storagePath: state.root,
      scientificImport: { synthetic: true, studyKey: input.dataset, studyTitle: "Internal metadata", sampleKey: "sample_0", sampleTitle: "sample_0", technology: "long", reads: [{ path: path.join(state.root, "internal-read"), sha256: "a".repeat(64), bytes: 1 }] },
    }));
    expect((await getCamiSampleStatuses(userId, query))[0].status).toBe("imported");
    await expect(enqueue(0)).rejects.toThrow("already exist");
    const other = await db.user.create({ data: { email: `${randomUUID()}@local-test.invalid`, password: "not-a-login-hash", firstName: "Other", lastName: "Owner" } });
    expect((await getCamiSampleStatuses(other.id, query)).every(sample => sample.status === "available")).toBe(true);
  });
  it("promotes a legacy import without moving studies or files and is idempotent", async () => {
    const study = await db.study.create({ data: { userId, title: "Internal legacy-migration fixture" } });
    const sample = await db.sample.create({ data: { id: `imported-sample-${randomUUID()}`, studyId: study.id, sampleId: "internal-migration-fixture", facilityStatus: "NOT_APPLICABLE", customFields: JSON.stringify({ sourceType: "cami-benchmark", dataset: "internal-migration-fixture" }) } });
    const read = await db.read.create({ data: { sampleId: sample.id, dataClassSource: "external_import", isActive: false, file1: "/internal-migration-fixture/unchanged.fastq" } });
    const sql = await fs.readFile(new URL("../../../prisma/migrations/20260907170000_shared_legacy_import_containers/migration.sql", import.meta.url), "utf8");
    await db.$executeRawUnsafe(sql);
    await db.$executeRawUnsafe(sql);
    const changed = await db.sample.findUniqueOrThrow({ where: { id: sample.id } });
    expect(changed.orderId).toBe(scientificRecordId("data", userId, "cami-benchmark", "internal-migration-fixture"));
    expect(changed.studyId).toBe(study.id);
    expect((await db.order.findUniqueOrThrow({ where: { id: changed.orderId! } })).userId).toBe(userId);
    expect((await db.read.findUniqueOrThrow({ where: { id: read.id } })).file1).toBe(read.file1);
    expect(await db.order.count({ where: { userId } })).toBe(1);
  });
  it("publishes named data without a study, supports later study links, and rejects duplicates", async () => {
    const result = { collection, cacheKey: "internal", name: "Internal", sourceType: "local-internal-test", sourceMetadata: { synthetic: true }, storagePath: state.root,
      scientificImport: { synthetic: true, studyKey: "internal-study", studyTitle: "Internal test study", sampleKey: "local-sample", sampleTitle: "Local sample", technology: "short" as const,
        reads: [{ path: path.join(state.root, "R1"), sha256: "a".repeat(64), bytes: 1 }, { path: path.join(state.root, "R2"), sha256: "b".repeat(64), bytes: 1 }] } };
    const first = await db.$transaction(tx => publishScientificImport(tx, userId, result));
    expect((await db.sample.findUniqueOrThrow({ where: { id: first!.sampleId } })).orderId).toBe(first!.orderId);
    expect((await db.order.findUniqueOrThrow({ where: { id: first!.orderId } })).dataOrigin).toBe("import");
    expect(first!.studyId).toBeNull();
    expect((await db.order.findUniqueOrThrow({ where: { id: first!.orderId } })).name).toBe(collection.name);
    expect((await db.sample.findUniqueOrThrow({ where: { id: first!.sampleId } })).studyId).toBeNull();
    expect(await db.studySample.count({ where: { sampleId: first!.sampleId } })).toBe(0);
    expect(await db.study.count({ where: { userId } })).toBe(0);
    await expect(db.$transaction(tx => publishScientificImport(tx, userId, result))).rejects.toThrow(/already been imported/);
    const long = { ...result, scientificImport: { ...result.scientificImport, technology: "long" as const, reads: [result.scientificImport.reads[0]] } };
    const added = await db.$transaction(tx => publishScientificImport(tx, userId, long));
    expect(added!.sampleId).toBe(first!.sampleId);
    expect(await db.read.count({ where: { sampleId: first!.sampleId } })).toBe(2);
    expect(await db.read.count({ where: { sampleId: first!.sampleId, isActive: true } })).toBe(0);
    const comparison = await db.study.create({ data: { userId, title: "Control comparison" } });
    await db.studySample.create({ data: { studyId: comparison.id, sampleId: first!.sampleId, role: "control", groupLabel: "External controls" } });
    await db.studySample.delete({ where: { studyId_sampleId: { studyId: comparison.id, sampleId: first!.sampleId } } });
    expect((await db.sample.findUniqueOrThrow({ where: { id: first!.sampleId } })).studyId).toBe(first!.studyId);
    expect(await db.read.count({ where: { sampleId: first!.sampleId } })).toBe(2);
    const rollback = { ...result, scientificImport: { ...result.scientificImport, studyKey: "rollback-study" } };
    await expect(db.$transaction(async tx => { await publishScientificImport(tx, userId, rollback); throw new Error("Internal fault"); })).rejects.toThrow("Internal fault");
    expect(await db.study.count({ where: { userId } })).toBe(1);
    expect(await db.order.count({ where: { userId } })).toBe(1);
  });
  it("deduplicates concurrent requests and executes their job once", async () => {
    const key = randomUUID();
    const jobs = await Promise.all(Array.from({ length: 6 }, () => create(key)));
    expect(new Set(jobs.map((item) => item.job.id)).size).toBe(1);
    const id = jobs[0].job.id;
    await Promise.all(Array.from({ length: 6 }, () => runWorkbenchImportJob(id)));
    expect(state.starts).toHaveBeenCalledTimes(1);
    const row = await db.workbenchImportJob.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("success");
    expect(await db.workbenchWorkspaceDataset.count({ where: { createdByImportJobId: id } })).toBe(1);
    await runWorkbenchImportJob(id);
    expect(state.starts).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])("runs local validated reads through the worker with user processing declaration: %s", async declared => {
    state.starts.mockImplementation(async (context: WorkbenchImportStartContext<unknown>) => {
      const file = path.join(context.storage.cacheDir, "internal.fastq.gz");
      await fs.writeFile(file, gzipSync("@internal/1\nACGT\n+\n!!!!\n@internal/2\nTGCA\n+\n####\n"));
      const reads = await prepareBenchmarkReads(file, "short");
      return { cacheKey: context.cacheKey, name: "Internal validated reads", sourceType: "local-internal-test", sourceMetadata: { synthetic: true }, storagePath: context.storage.cacheDir,
        scientificImport: { synthetic: true, studyKey: "local-validated", studyTitle: "Local validated", sampleKey: "local", sampleTitle: "Local", technology: "short", reads } };
    });
    const declaration = { state: "cleaned" as const, details: "Internal classification test evidence" };
    const { job } = await createWorkbenchImportJob({ userId, providerId: "local-internal-test", input: { selection: "local", collection, ...(declared ? { processingDeclaration: declaration } : {}) }, preview, idempotencyKey: randomUUID() });
    const queuedOrderId = scientificRecordId("data", userId, "collection", collection.key);
    const queuedOrder = await db.order.findUniqueOrThrow({ where: { id: queuedOrderId } });
    expect(queuedOrder.name).toBe(collection.name);
    expect(JSON.parse(queuedOrder.sourceMetadata!).collectionKey).toBe(collection.key);
    expect(await db.sample.count({ where: { orderId: queuedOrderId } })).toBe(0);
    await runWorkbenchImportJob(job.id);
    const completed = await db.workbenchImportJob.findUniqueOrThrow({ where: { id: job.id }, include: { resultDataset: true } });
    expect(completed.status).toBe("success");
    expect(await db.inAppNotification.count({ where: { userId, sourceId: job.id, linkPath: `/orders/${queuedOrderId}/samples-files` } })).toBe(1);
    const records = JSON.parse(completed.resultDataset!.sourceMetadata!).scientificRecords;
    const sample = await db.sample.findUniqueOrThrow({ where: { id: records.sampleId }, include: { reads: true, study: true } });
    expect(sample.orderId).toBe(records.orderId); expect(sample.study).toBeNull();
    expect(records).toMatchObject({ orderTitle: collection.name, studyId: null, studyTitle: null });
    expect((await db.order.findUniqueOrThrow({ where: { id: sample.orderId! } })).name).toBe(collection.name);
    expect(sample.reads).toHaveLength(1);
    expect(sample.reads[0]).toMatchObject({ dataClass: declared ? "cleaned" : "unknown", dataClassSource: declared ? "manual" : "external_import", isActive: false, classifiedById: declared ? userId : null });
    const processing = JSON.parse(sample.reads[0].pipelineSources!).processing;
    expect(processing.source).toMatchObject({ state: "unknown", evidence: "not_provided" });
    if (declared) expect(processing.userDeclaration).toMatchObject({ ...declaration, userId });
    else expect(processing.userDeclaration).toBeUndefined();
    expect((await fs.stat(sample.reads[0].file1!)).size).toBeGreaterThan(0);
    expect((await fs.stat(sample.reads[0].file2!)).size).toBeGreaterThan(0);
  });
  it("keeps project samples together in the named collection and preserves source study metadata", async () => {
    const entry = { synthetic: false, studyKey: "source-project-a", studyTitle: "Source project A", sampleKey: "one", sampleTitle: "One", technology: "single" as const,
      metadata: { originalStudy: { accession: "internal-project-A", xml: "<STUDY><TITLE>Internal source metadata</TITLE></STUDY>" } },
      reads: [{ path: path.join(state.root, "local.fastq"), sha256: "a".repeat(64), bytes: 1 }] };
    const result = { collection, cacheKey: "internal", name: "Internal", sourceType: "local-internal-test", sourceMetadata: {}, storagePath: state.root,
      scientificImports: [entry, { ...entry, studyKey: "source-project-b", sampleKey: "two" }] };
    const records = await db.$transaction(tx => publishScientificImport(tx, userId, result));
    expect(records!.entries).toHaveLength(2);
    expect(new Set(records!.entries!.map(record => record.orderId)).size).toBe(1);
    const stored = await db.order.findUniqueOrThrow({ where: { id: records!.orderId } });
    expect(JSON.parse(stored.sourceMetadata!).sources.map((source: { sourceKey: string }) => source.sourceKey)).toEqual(["source-project-a", "source-project-b"]);
    expect(await db.order.count({ where: { userId } })).toBe(1);
    expect(await db.study.count({ where: { userId } })).toBe(0);
    const sample = await db.sample.findUniqueOrThrow({ where: { id: records!.sampleId } });
    expect(JSON.parse(sample.customFields!).originalMetadata.originalStudy).toEqual(entry.metadata.originalStudy);
    // A distinct named collection is an explicit independent copy, not a move.
    const copy = await db.$transaction(tx => publishScientificImport(tx, userId, { ...result, collection: { key: randomUUID(), name: "Separate comparison data" } }));
    expect(copy!.orderId).not.toBe(records!.orderId);
    expect(copy!.sampleId).not.toBe(records!.sampleId);
    expect(await db.sample.count({ where: { orderId: records!.orderId } })).toBe(2);
  });
  it("scopes collection keys to their owner and never renames an existing collection during import", async () => {
    const entry = { synthetic: true, studyKey: "local-study", studyTitle: "Local", sampleKey: "one", sampleTitle: "One", technology: "single" as const,
      reads: [{ path: path.join(state.root, "local.fastq"), sha256: "a".repeat(64), bytes: 1 }] };
    const result = { collection, cacheKey: "internal", name: "Internal", sourceType: "local-internal-test", sourceMetadata: {}, storagePath: state.root, scientificImport: entry };
    const first = await db.$transaction(tx => publishScientificImport(tx, userId, result));
    await db.order.update({ where: { id: first!.orderId }, data: { name: "Edited in metadata" } });
    const second = await db.$transaction(tx => publishScientificImport(tx, userId, { ...result, scientificImport: { ...entry, sampleKey: "two" } }));
    expect(second!.orderTitle).toBe("Edited in metadata");
    const other = await db.user.create({ data: { email: `${randomUUID()}@local-test.invalid`, password: "not-a-login-hash", firstName: "Other", lastName: "Owner" } });
    const separate = await db.$transaction(tx => publishScientificImport(tx, other.id, result));
    expect(separate!.orderId).not.toBe(first!.orderId);
    expect((await db.order.findUniqueOrThrow({ where: { id: first!.orderId } })).userId).toBe(userId);
  });
  it("isolates simultaneous independent imports of the same source", async () => {
    const jobs = await Promise.all([create(), create()]);
    await Promise.all(jobs.map(({ job }) => runWorkbenchImportJob(job.id)));
    const rows = await db.workbenchImportJob.findMany({ where: { id: { in: jobs.map(({ job }) => job.id) } } });
    expect(rows.every((row) => row.status === "success")).toBe(true);
    expect(new Set(rows.map((row) => row.targetPath)).size).toBe(2);
    expect(new Set(rows.map((row) => row.resultDatasetId)).size).toBe(2);
  });
  it("does not publish after the owner is deactivated during transfer", async () => {
    const implementation = state.starts.getMockImplementation()!;
    state.starts.mockImplementation(async (context) => {
      const result = await implementation(context);
      await db.user.update({ where: { id: userId }, data: { isActive: false } });
      return result;
    });
    const { job } = await create(); await runWorkbenchImportJob(job.id);
    const row = await db.workbenchImportJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("error"); expect(row.resultDatasetId).toBeNull();
    expect(await db.workbenchWorkspaceDataset.count({ where: { createdByImportJobId: job.id } })).toBe(0);
  });
  it("rolls back dataset publication when the job terminal transition fails", async () => {
    const implementation = state.starts.getMockImplementation()!;
    let key = "";
    state.starts.mockImplementation(async (context) => {
      key = context.cacheKey;
      const result = await implementation(context);
      // Internal fault injection, not a supported running-cancellation API.
      await db.workbenchImportJob.update({ where: { id: context.jobId }, data: { status: "cancelled" } });
      return result;
    });
    const { job } = await create(); await runWorkbenchImportJob(job.id);
    expect(await db.workbenchDataset.findUnique({ where: { cacheKey: key } })).toBeNull();
    expect(await db.workbenchWorkspaceDataset.count({ where: { createdByImportJobId: job.id } })).toBe(0);
    expect((await db.workbenchImportJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("cancelled");
  });

  it("recovers queued work and fails an expired runner without replaying it", async () => {
    const stale = await create(), queued = await create();
    await db.workbenchImportJob.update({ where: { id: stale.job.id }, data: {
      status: "running", updatedAt: new Date(Date.now() - 600_000),
    } });
    await reconcileWorkbenchImports();
    expect((await db.workbenchImportJob.findUniqueOrThrow({ where: { id: stale.job.id } })).phase).toBe("interrupted");
    expect((await db.workbenchImportJob.findUniqueOrThrow({ where: { id: queued.job.id } })).status).toBe("success");
    expect(state.starts).toHaveBeenCalledTimes(1);
  });

  it("keeps excess work queued under the database-wide concurrency limit", async () => {
    const occupied = await Promise.all([create(), create()]);
    await db.workbenchImportJob.updateMany({ where: { id: { in: occupied.map(({ job }) => job.id) } }, data: { status: "running" } });
    const waiting = await create();
    await runWorkbenchImportJob(waiting.job.id);
    expect((await db.workbenchImportJob.findUniqueOrThrow({ where: { id: waiting.job.id } })).status).toBe("queued");
    expect(state.starts).not.toHaveBeenCalled();
  });
});
