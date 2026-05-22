import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { WorkbenchImporterProvider } from "./importers/types";

const mocks = vi.hoisted(() => ({
  db: {
    workbenchWorkspace: {
      upsert: vi.fn(),
    },
    workbenchImportJob: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
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
  updateWorkbenchAnalysisNodeForImportJob: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/workbench/storage", () => ({
  resolveWorkbenchImportStorage: mocks.resolveWorkbenchImportStorage,
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
    await fs.rm(tempDir, { recursive: true, force: true });
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
        summary: { selectedCount: 0 },
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

  it("reuses a ready shared cache dataset instead of downloading again", async () => {
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

    await runWorkbenchImportJob("job-1");

    expect(provider.start).not.toHaveBeenCalled();
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
      where: { id: "job-1" },
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
    provider.start = vi.fn().mockResolvedValue({
      cacheKey: "cache-123",
      name: "Escaped dataset",
      sourceType: "mock-provider",
      sourceMetadata: {},
      storagePath: path.join(tempDir, "outside-cache"),
    });
    mocks.db.workbenchImportJob.update.mockResolvedValue({});

    await runWorkbenchImportJob("job-1");

    expect(mocks.db.workbenchDataset.upsert).not.toHaveBeenCalled();
    expect(mocks.db.workbenchWorkspaceDataset.upsert).not.toHaveBeenCalled();
    expect(mocks.db.workbenchImportJob.update).toHaveBeenLastCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "error",
        phase: "failed",
        error: expect.stringContaining("Workbench import result path must stay inside"),
      }),
    });
  });
});
