import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { WorkbenchImporterProvider } from "./importers/types";

const mocks = vi.hoisted(() => ({
  requireRawReadImporter: vi.fn(),
  db: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    workbenchWorkspace: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
    },
    workbenchImportJob: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    workbenchDataset: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    workbenchWorkspaceDataset: {
      upsert: vi.fn(),
    },
  },
  getWorkbenchImporter: vi.fn(),
  resolveWorkbenchImportStorage: vi.fn(),
  resolveWorkbenchStorageBase: vi.fn(),
  updateWorkbenchAnalysisNodeForImportJob: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/modules/input-modules.server", () => ({ requireRawReadImporter: mocks.requireRawReadImporter }));

vi.mock("@/lib/workbench/storage", () => ({
  resolveWorkbenchImportStorage: mocks.resolveWorkbenchImportStorage,
  resolveWorkbenchStorageBase: mocks.resolveWorkbenchStorageBase,
  assertPathInsideBase: (targetPath: string, basePath: string, label = "Path") => {
    const relative = path.relative(path.resolve(basePath), path.resolve(targetPath));
    if (relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative))) {
      throw new Error(`${label} must stay inside ${basePath}`);
    }
  },
}));

vi.mock("./importers/registry", () => ({
  getWorkbenchImporter: mocks.getWorkbenchImporter,
}));

vi.mock("@/lib/workbench/analyses", () => ({
  updateWorkbenchAnalysisNodeForImportJob: mocks.updateWorkbenchAnalysisNodeForImportJob,
}));

import { CAMI_PREPARATION_BYTES, IMPORT_STORAGE_HEADROOM, ImportStorageUnavailable, STORAGE_WAITING, STORAGE_UNKNOWN, PREPARATION_WAITING } from "./import-storage-capacity";
import { createWorkbenchImportJob, runWorkbenchImportJob } from "./import-jobs";

const provider: WorkbenchImporterProvider<{ taxon: string }> = {
  id: "mock-provider",
  label: "Mock Provider",
  description: "Mock",
  category: "Reference genomes",
  inputSchema: z.object({ taxon: z.string() }),
  preflight: vi.fn(),
  preview: vi.fn(),
  getCacheKey: vi.fn(() => "cache-123"),
  start: vi.fn(),
};

const now = new Date("2026-05-20T10:00:00.000Z");
let tempDir: string;

describe("workbench import jobs", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.db.$transaction.mockImplementation((callback) => callback(mocks.db));
    mocks.db.$queryRaw.mockReset().mockResolvedValue([{ id: "workspace-1" }]);
    mocks.db.workbenchImportJob.count.mockResolvedValue(0);
    mocks.db.workbenchWorkspace.findFirst.mockReset().mockResolvedValue({ id: "workspace-1" });
    mocks.db.workbenchImportJob.updateMany.mockReset().mockResolvedValue({ count: 1 });
    provider.getCacheKey = vi.fn(() => "cache-123");
    provider.start = vi.fn();
    mocks.updateWorkbenchAnalysisNodeForImportJob.mockResolvedValue(undefined);
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-import-jobs-"));
    mocks.getWorkbenchImporter.mockReturnValue(provider);
    mocks.db.workbenchWorkspace.upsert.mockResolvedValue({
      id: "workspace-1",
      ownerId: "user-1",
      name: "Private Workbench",
    });
    mocks.resolveWorkbenchImportStorage.mockResolvedValue({
      cacheDir: path.join(tempDir, "workbench", "cache", "mock-provider", "cache-123"),
      jobDir: path.join(tempDir, "workbench", "jobs", "job-1"),
      logPath: path.join(tempDir, "workbench", "jobs", "job-1", "import.log"),
      baseDir: path.join(tempDir, "workbench"),
      cacheRoot: path.join(tempDir, "workbench", "cache"),
      jobsRoot: path.join(tempDir, "workbench", "jobs"),
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function camiJob() {
    mocks.db.workbenchImportJob.findUnique.mockResolvedValue({
      id: "job-1", providerId: "cami-benchmark", status: "queued",
      workspaceId: "workspace-1", createdById: "user-1",
      request: JSON.stringify({ taxon: "test" }), preview: "{}",
    });
    mocks.getWorkbenchImporter.mockReturnValue({ ...provider, id: "cami-benchmark" });
    mocks.resolveWorkbenchStorageBase.mockResolvedValue({ cacheRoot: tempDir });
  }

  it("keeps insufficient storage queued, then starts automatically when capacity returns", async () => {
    camiJob();
    const capacity = vi.spyOn(fs, "statfs").mockResolvedValue({ bavail: 1, bsize: 1 } as Awaited<ReturnType<typeof fs.statfs>>);
    await runWorkbenchImportJob("job-1");
    expect(provider.start).not.toHaveBeenCalled();
    expect(mocks.db.workbenchImportJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: "job-1", status: "queued" }, data: { phase: STORAGE_WAITING },
    });
    capacity.mockResolvedValue({ bavail: CAMI_PREPARATION_BYTES + IMPORT_STORAGE_HEADROOM, bsize: 1 } as Awaited<ReturnType<typeof fs.statfs>>);
    await runWorkbenchImportJob("job-1");
    expect(provider.start).toHaveBeenCalledTimes(1);
  });

  it("does not start when capacity cannot be checked", async () => {
    camiJob();
    vi.spyOn(fs, "statfs").mockRejectedValue(new Error("Unavailable mount"));
    await runWorkbenchImportJob("job-1");
    expect(provider.start).not.toHaveBeenCalled();
    expect(mocks.db.workbenchImportJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: "job-1", status: "queued" }, data: { phase: STORAGE_UNKNOWN },
    });
  });

  it("reserves one CAMI preparation slot across runners", async () => {
    camiJob();
    mocks.db.workbenchImportJob.count.mockResolvedValue(1);
    await runWorkbenchImportJob("job-1");
    expect(provider.start).not.toHaveBeenCalled();
    expect(mocks.resolveWorkbenchStorageBase).not.toHaveBeenCalled();
    expect(mocks.db.workbenchImportJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: "job-1", status: "queued" }, data: { phase: PREPARATION_WAITING },
    });
  });

  it("stops an active transfer when the periodic check detects low storage", async () => {
    vi.useFakeTimers();
    camiJob();
    const capacity = vi.spyOn(fs, "statfs").mockResolvedValue({ bavail: CAMI_PREPARATION_BYTES + IMPORT_STORAGE_HEADROOM, bsize: 1 } as Awaited<ReturnType<typeof fs.statfs>>);
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(provider.start).mockImplementationOnce(async context => {
      started();
      return new Promise((_, reject) => {
        context.signal!.addEventListener("abort", () => reject(context.signal!.reason), { once: true });
      });
    });
    const running = runWorkbenchImportJob("job-1");
    await ready;
    capacity.mockResolvedValue({ bavail: 0, bsize: 1 } as Awaited<ReturnType<typeof fs.statfs>>);
    await vi.advanceTimersByTimeAsync(15_000);
    await running;
    expect(mocks.db.workbenchImportJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: "job-1", status: "running", NOT: { phase: "cancelling" } },
      data: expect.objectContaining({ status: "queued", phase: STORAGE_WAITING }),
    });
    expect(mocks.db.workbenchDataset.upsert).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["preflight", "ENOSPC", "EDQUOT"])("cleans partial files before requeuing after %s", async failure => {
    camiJob();
    vi.spyOn(fs, "statfs").mockResolvedValue({ bavail: CAMI_PREPARATION_BYTES + IMPORT_STORAGE_HEADROOM, bsize: 1 } as Awaited<ReturnType<typeof fs.statfs>>);
    const storage = await mocks.resolveWorkbenchImportStorage();
    vi.mocked(provider.start).mockImplementationOnce(async () => {
      await fs.mkdir(storage.cacheDir, { recursive: true });
      await fs.writeFile(path.join(storage.cacheDir, "partial"), "internal worker fixture");
      throw failure === "preflight" ? new ImportStorageUnavailable(STORAGE_WAITING)
        : Object.assign(new Error("Storage write failed"), { code: failure });
    });
    mocks.db.workbenchImportJob.updateMany.mockImplementation(async ({ data }) => {
      if (data.status === "queued") {
        await expect(fs.access(storage.cacheDir)).rejects.toThrow();
      }
      return { count: 1 };
    });
    await runWorkbenchImportJob("job-1");
    expect(mocks.db.workbenchImportJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: "job-1", status: "running", NOT: { phase: "cancelling" } },
      data: expect.objectContaining({ status: "queued", phase: STORAGE_WAITING, progress: 0, error: null }),
    });
    expect(mocks.db.workbenchDataset.upsert).not.toHaveBeenCalled();
  });

  it("creates jobs in the user's lazily-created default workspace", async () => {
    mocks.db.workbenchImportJob.create.mockResolvedValue({
      id: "job-1",
      providerId: "mock-provider",
      status: "queued",
      phase: "queued",
      request: JSON.stringify({ taxon: "Escherichia coli" }),
      preview: JSON.stringify({ genomes: [] }),
      progress: 0,
      logPath: null,
      targetPath: null,
      error: null,
      resultDatasetId: null,
      analysisId: null,
      analysisNodeId: null,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const result = await createWorkbenchImportJob({
      userId: "user-1",
      providerId: "mock-provider",
      input: { taxon: "Escherichia coli" },
      preview: {
        providerId: "mock-provider",
        summary: {
          label: "No genomes selected",
          totalFound: 0,
          selectedCount: 0,
          capped: false,
          cap: 0,
          hardMax: 0,
        },
        genomes: [],
      },
    });

    expect(mocks.db.workbenchWorkspace.upsert).toHaveBeenCalledWith({
      where: { ownerId: "user-1" },
      create: {
        ownerId: "user-1",
        name: "Private Workbench",
        isDefault: true,
      },
      update: {},
    });
    expect(mocks.db.workbenchImportJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace-1",
        providerId: "mock-provider",
        status: "queued",
        createdById: "user-1",
      }),
    });
    expect(result.cacheKey).toBe("cache-123");
    expect(result.job.id).toBe("job-1");
  });

  it("does not reuse a mutable shared cache dataset", async () => {
    mocks.db.workbenchImportJob.findUnique.mockResolvedValue({
      id: "job-1",
      providerId: "mock-provider",
      workspaceId: "workspace-1",
      createdById: "user-1",
      analysisId: null,
      analysisNodeId: null,
      progress: 0,
      request: JSON.stringify({ taxon: "Escherichia coli" }),
      preview: JSON.stringify({
        providerId: "mock-provider",
        summary: {},
        genomes: [{ accession: "GCF_1" }],
      }),
    });
    mocks.db.workbenchDataset.findUnique.mockResolvedValue({
      id: "dataset-1",
      cacheKey: "cache-123",
      name: "Cached E. coli",
      description: "Existing cache",
      sourceType: "mock-provider",
      sourceMetadata: JSON.stringify({ taxon: "Escherichia coli" }),
      storagePath: path.join(tempDir, "workbench", "cache", "mock-provider", "cache-123"),
      sizeBytes: BigInt(1024),
      checksumSha256: "abc",
      genomeCount: 1,
      status: "ready",
    });
    mocks.db.workbenchDataset.upsert.mockResolvedValue({
      id: "dataset-1",
      name: "Cached E. coli",
    });
    mocks.db.workbenchWorkspaceDataset.upsert.mockResolvedValue({});
    mocks.db.workbenchImportJob.update.mockResolvedValue({});
    provider.start = vi.fn().mockImplementation(async (context) => ({
      cacheKey: context.cacheKey, name: "New private import", sourceType: provider.id,
      sourceMetadata: {}, storagePath: context.storage.cacheDir,
    }));

    await runWorkbenchImportJob("job-1");

    expect(provider.start).toHaveBeenCalledTimes(1);
    expect(mocks.db.workbenchDataset.findUnique).not.toHaveBeenCalled();
    expect(mocks.resolveWorkbenchImportStorage).toHaveBeenCalledWith({
      providerId: provider.id, jobId: "job-1", cacheKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(mocks.db.workbenchWorkspaceDataset.upsert).toHaveBeenCalledWith({
      where: {
        workspaceId_datasetId: {
          workspaceId: "workspace-1",
          datasetId: "dataset-1",
        },
      },
      create: {
        workspaceId: "workspace-1",
        datasetId: "dataset-1",
        createdByImportJobId: "job-1",
      },
      update: {
        createdByImportJobId: "job-1",
      },
    });
    expect(mocks.db.workbenchImportJob.update).toHaveBeenLastCalledWith({
      where: { id: "job-1", status: "running", NOT: { phase: "cancelling" } },
      data: expect.objectContaining({
        status: "success",
        phase: "complete",
        progress: 100,
        resultDatasetId: "dataset-1",
      }),
    });
  });

  it("rejects importer result paths outside the assigned cache root", async () => {
    mocks.db.workbenchImportJob.findUnique.mockResolvedValue({
      id: "job-1",
      providerId: "mock-provider",
      workspaceId: "workspace-1",
      createdById: "user-1",
      analysisId: null,
      analysisNodeId: null,
      progress: 0,
      request: JSON.stringify({ taxon: "Escherichia coli" }),
      preview: JSON.stringify({
        providerId: "mock-provider",
        summary: {},
        genomes: [{ accession: "GCF_1" }],
      }),
    });
    mocks.db.workbenchDataset.findUnique.mockResolvedValue(null);
    provider.start = vi.fn().mockImplementation(async (context) => ({
      cacheKey: context.cacheKey,
      name: "Escaped dataset",
      sourceType: "mock-provider",
      sourceMetadata: {},
      storagePath: path.join(tempDir, "outside-cache"),
    }));
    mocks.db.workbenchImportJob.update.mockResolvedValue({});

    await runWorkbenchImportJob("job-1");

    expect(mocks.db.workbenchDataset.upsert).not.toHaveBeenCalled();
    expect(mocks.db.workbenchWorkspaceDataset.upsert).not.toHaveBeenCalled();
    expect(mocks.db.workbenchImportJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: "job-1", status: "running", NOT: { phase: "cancelling" } },
      data: expect.objectContaining({
        status: "error",
        phase: "failed",
        error: expect.stringContaining("Workbench import result path must stay inside"),
      }),
    });
  });

  it.each(["running", "success", "error", "cancelled"])("does not execute a %s job again", async (status) => {
    mocks.db.workbenchImportJob.findUnique.mockResolvedValue({ id: "job-1", status });
    mocks.db.workbenchImportJob.updateMany.mockResolvedValue({ count: 0 });
    await runWorkbenchImportJob("job-1");
    expect(mocks.db.workbenchImportJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "queued" },
      data: expect.objectContaining({ status: "running" }),
    });
    expect(provider.start).not.toHaveBeenCalled();
    expect(mocks.resolveWorkbenchImportStorage).not.toHaveBeenCalled();
  });

  it("preserves successful publication when the canvas notification fails", async () => {
    mocks.db.workbenchImportJob.findUnique.mockResolvedValue({
      id: "job-1", providerId: provider.id, workspaceId: "workspace-1",
      createdById: "user-1", request: JSON.stringify({ taxon: "test" }),
      preview: JSON.stringify({ genomes: [] }),
    });
    mocks.db.workbenchDataset.findUnique.mockResolvedValue(null);
    const storage = await mocks.resolveWorkbenchImportStorage();
    provider.start = vi.fn().mockImplementation(async (context) => ({
      cacheKey: context.cacheKey, name: "Local internal test dataset",
      sourceType: provider.id, sourceMetadata: {}, storagePath: storage.cacheDir,
    }));
    mocks.db.workbenchDataset.upsert.mockResolvedValue({ id: "dataset-1" });
    mocks.updateWorkbenchAnalysisNodeForImportJob
      .mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Canvas unavailable"));
    mocks.db.workbenchImportJob.updateMany
      .mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    await runWorkbenchImportJob("job-1");

    expect(mocks.db.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.db.workbenchImportJob.update).toHaveBeenLastCalledWith({
      where: { id: "job-1", status: "running", NOT: { phase: "cancelling" } },
      data: expect.objectContaining({ status: "success", resultDatasetId: "dataset-1" }),
    });
    expect(mocks.updateWorkbenchAnalysisNodeForImportJob).toHaveBeenCalledTimes(2);
  });

  it("allows only one runner past the atomic claim", async () => {
    mocks.db.workbenchImportJob.findUnique.mockResolvedValue({
      id: "job-1", providerId: "missing", status: "queued",
    });
    mocks.getWorkbenchImporter.mockReturnValue(null);
    mocks.db.workbenchImportJob.updateMany
      .mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await Promise.all([runWorkbenchImportJob("job-1"), runWorkbenchImportJob("job-1")]);
    expect(mocks.getWorkbenchImporter).toHaveBeenCalledTimes(1);
  });

  it("reuses the same job for a repeated request key", async () => {
    const input = { taxon: "test" };
    const preview = { providerId: provider.id, summary: {
      label: "Internal", totalFound: 1, selectedCount: 1, capped: false, cap: 1, hardMax: 1,
    }, genomes: [] };
    mocks.db.workbenchImportJob.create.mockRejectedValueOnce({ code: "P2002" });
    mocks.db.workbenchImportJob.findUnique.mockResolvedValue({
      id: "existing", workspaceId: "workspace-1", createdById: "user-1",
      request: JSON.stringify(input), preview: JSON.stringify(preview),
      status: "running", createdAt: now, updatedAt: now,
    });
    const result = await createWorkbenchImportJob({
      userId: "user-1", providerId: provider.id, input, preview, idempotencyKey: "internal-test-request",
    });
    expect(result.job.id).toBe("existing");
    expect(mocks.updateWorkbenchAnalysisNodeForImportJob).not.toHaveBeenCalled();
    expect(mocks.db.workbenchImportJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: expect.stringMatching(/^import-[a-f0-9]{64}$/) }),
    });
  });

  it.each(["before transfer", "before publication"])("rejects lost destination access %s", async (stage) => {
    mocks.db.workbenchImportJob.findUnique.mockResolvedValue({
      id: "job-1", providerId: provider.id, workspaceId: "workspace-1",
      createdById: "user-1", request: JSON.stringify({ taxon: "test" }), preview: "{}",
    });
    mocks.db.workbenchWorkspace.findFirst.mockResolvedValue(null);
    if (stage === "before publication") {
      mocks.db.workbenchWorkspace.findFirst.mockResolvedValueOnce({ id: "workspace-1" });
      mocks.db.$queryRaw.mockResolvedValue([]);
    }
    provider.start = vi.fn().mockImplementation(async (context) => ({
      cacheKey: context.cacheKey, name: "Internal test", sourceType: provider.id,
      sourceMetadata: {}, storagePath: context.storage.cacheDir,
    }));
    await runWorkbenchImportJob("job-1");
    expect(mocks.db.workbenchDataset.upsert).not.toHaveBeenCalled();
    expect(mocks.db.workbenchImportJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: "job-1", status: "running", NOT: { phase: "cancelling" } },
      data: expect.objectContaining({ status: "error", error: expect.stringContaining("no longer available") }),
    });
    expect(provider.start).toHaveBeenCalledTimes(stage === "before transfer" ? 0 : 1);
  });
});
