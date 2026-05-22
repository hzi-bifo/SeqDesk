import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    workbenchWorkspace: {
      upsert: vi.fn(),
    },
    workbenchWorkspaceDataset: {
      findMany: vi.fn(),
    },
    workbenchImportJob: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import {
  getOrCreateDefaultWorkbenchWorkspace,
  listWorkbenchDatasets,
  listWorkbenchImportJobs,
  serializeWorkbenchDatasetLink,
  serializeWorkbenchImportJob,
} from "./workspaces";

const now = new Date("2026-05-20T10:00:00.000Z");

describe("workbench workspace helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.workbenchWorkspace.upsert.mockResolvedValue({
      id: "workspace-a",
      ownerId: "user-a",
      name: "Private Workbench",
    });
    mocks.db.workbenchWorkspaceDataset.findMany.mockResolvedValue([]);
    mocks.db.workbenchImportJob.findMany.mockResolvedValue([]);
  });

  it("lazily creates one private workspace per user", async () => {
    await getOrCreateDefaultWorkbenchWorkspace("user-a");

    expect(mocks.db.workbenchWorkspace.upsert).toHaveBeenCalledWith({
      where: { ownerId: "user-a" },
      create: {
        ownerId: "user-a",
        name: "Private Workbench",
        isDefault: true,
      },
      update: {},
    });
  });

  it("lists datasets through the current user's workspace link only", async () => {
    await listWorkbenchDatasets("user-a");

    expect(mocks.db.workbenchWorkspaceDataset.findMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace-a" },
      orderBy: { linkedAt: "desc" },
      include: { dataset: true },
    });
  });

  it("lists jobs through the current user's workspace only", async () => {
    await listWorkbenchImportJobs("user-a");

    expect(mocks.db.workbenchImportJob.findMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace-a" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  });

  it("serializes datasets and jobs without leaking BigInt values", () => {
    const dataset = serializeWorkbenchDatasetLink({
      linkedAt: now,
      dataset: {
        id: "dataset-a",
        providerId: "provider",
        name: "Dataset",
        description: null,
        sourceType: "provider",
        sourceMetadata: JSON.stringify({ taxon: "Escherichia coli" }),
        storagePath: "/data/workbench/cache/provider/cache",
        sizeBytes: BigInt(1024),
        checksumSha256: "abc",
        genomeCount: 1,
        status: "ready",
        createdAt: now,
        updatedAt: now,
      },
    });
    const job = serializeWorkbenchImportJob({
      id: "job-a",
      providerId: "provider",
      status: "queued",
      phase: "queued",
      request: JSON.stringify({ taxon: "Escherichia coli" }),
      preview: null,
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

    expect(dataset.sizeBytes).toBe(1024);
    expect(JSON.stringify(dataset)).toContain("dataset-a");
    expect(JSON.stringify(job)).toContain("job-a");
  });
});
