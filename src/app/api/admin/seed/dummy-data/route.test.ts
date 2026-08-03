import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
  resolveDataBasePathFromStoredValue: vi.fn(),
  getDummyDataEnabledFlag: vi.fn(),
  getDummySeedFilesystemStatus: vi.fn(),
  getDummySeedStatus: vi.fn(),
  removeDummySeed: vi.fn(),
  runDummySeed: vi.fn(),
  updateAdminActivityJob: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/files/data-base-path", () => ({
  resolveDataBasePathFromStoredValue:
    mocks.resolveDataBasePathFromStoredValue,
}));

vi.mock("@/lib/seed/extra-settings-flag", () => ({
  getDummyDataEnabledFlag: mocks.getDummyDataEnabledFlag,
}));

vi.mock("@/lib/seed/run-seed", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/seed/run-seed")>();
  return {
    ...actual,
    getDummySeedFilesystemStatus:
      mocks.getDummySeedFilesystemStatus,
    getDummySeedStatus: mocks.getDummySeedStatus,
    removeDummySeed: mocks.removeDummySeed,
    runDummySeed: mocks.runDummySeed,
  };
});

vi.mock("@/lib/admin/activity", () => ({
  updateAdminActivityJob: mocks.updateAdminActivityJob,
}));

import { DELETE, GET, POST } from "./route";
import {
  DummySeedAlreadyExistsError,
  DummySeedInUseError,
} from "@/lib/seed/run-seed";

const ABSENT_FILESYSTEM = {
  folderPresent: false,
  referencedFilesCount: 0,
  validFilesCount: 0,
  invalidFilesCount: 0,
  filesComplete: false,
};

const HEALTHY_FILESYSTEM = {
  folderPresent: true,
  referencedFilesCount: 22,
  validFilesCount: 22,
  invalidFilesCount: 0,
  filesComplete: true,
};

const ORPHAN_FILESYSTEM = {
  ...ABSENT_FILESYSTEM,
  folderPresent: true,
};

const DAMAGED_FILESYSTEM = {
  folderPresent: true,
  referencedFilesCount: 22,
  validFilesCount: 21,
  invalidFilesCount: 1,
  filesComplete: false,
};

describe("/api/admin/seed/dummy-data", () => {
  let dataBasePath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    dataBasePath = await fs.mkdtemp(
      path.join(os.tmpdir(), "seqdesk-dummy-route-")
    );
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      dataBasePath,
    });
    mocks.db.user.findUnique.mockResolvedValue({
      email: "ada@example.org",
      firstName: "Ada",
      lastName: "Lovelace",
    });
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath,
      source: "database",
      isImplicit: false,
    });
    mocks.getDummyDataEnabledFlag.mockResolvedValue(false);
    mocks.getDummySeedFilesystemStatus.mockResolvedValue(
      ABSENT_FILESYSTEM
    );
    mocks.getDummySeedStatus.mockResolvedValue({
      seeded: false,
      ordersCount: 0,
      ordersByStatus: {},
    });
    mocks.removeDummySeed.mockResolvedValue({
      ordersDeleted: 0,
      filesRemoved: true,
    });
    mocks.updateAdminActivityJob.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await fs.rm(dataBasePath, { recursive: true, force: true });
  });

  it("requires a facility-admin session", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
    expect(mocks.db.siteSettings.findUnique).not.toHaveBeenCalled();
  });

  it("allows a demo facility admin to read status", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "demo-admin-1",
        role: "FACILITY_ADMIN",
        isDemo: true,
      },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.getDummySeedStatus).toHaveBeenCalledWith("demo-admin-1");
  });

  it("blocks demo facility admins from installing demo data", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "demo-admin-1",
        role: "FACILITY_ADMIN",
        isDemo: true,
      },
    });

    const response = await POST();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Demo-data changes are disabled in the public demo.",
    });
    expect(mocks.db.siteSettings.findUnique).not.toHaveBeenCalled();
    expect(mocks.runDummySeed).not.toHaveBeenCalled();
  });

  it("blocks demo facility admins from removing demo data", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "demo-admin-1",
        role: "FACILITY_ADMIN",
        isDemo: true,
      },
    });

    const response = await DELETE();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Demo-data changes are disabled in the public demo.",
    });
    expect(mocks.db.siteSettings.findUnique).not.toHaveBeenCalled();
    expect(mocks.removeDummySeed).not.toHaveBeenCalled();
  });

  it("reports the current admin's seeded orders by status", async () => {
    mocks.getDummySeedFilesystemStatus.mockResolvedValue(
      HEALTHY_FILESYSTEM
    );
    mocks.getDummySeedStatus.mockResolvedValue({
      seeded: true,
      databaseComplete: true,
      databasePresent: true,
      incomplete: false,
      ordersCount: 4,
      studiesCount: 2,
      samplesCount: 10,
      readsCount: 12,
      samplesWithSeedMetadataCount: 10,
      sampleMetadataComplete: true,
      readPathsComplete: true,
      ordersByStatus: {
        SUBMITTED: 3,
        DRAFT: 1,
      },
      storedDataBasePath: dataBasePath,
      pendingCleanupDataBasePath: null,
      storagePathConflict: false,
    });
    mocks.getDummyDataEnabledFlag.mockResolvedValue(true);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      seeded: true,
      databaseComplete: true,
      integrityComplete: true,
      ordersCount: 4,
      studiesCount: 2,
      samplesCount: 10,
      readsCount: 12,
      ordersByStatus: {
        SUBMITTED: 3,
        DRAFT: 1,
      },
      dummyDataEnabled: true,
      filesPresent: true,
      filesComplete: true,
      referencedFilesCount: 22,
      validFilesCount: 22,
      invalidFilesCount: 0,
      cleanupPending: false,
      storageReady: true,
      storageError: null,
      dataBasePath,
      fixtureDataBasePath: dataBasePath,
      fixtureStorageReady: true,
      fixtureStorageError: null,
    });
    expect(mocks.getDummySeedStatus).toHaveBeenCalledWith("admin-1");
  });

  it("reports a database-complete fixture with one damaged FASTQ as cleanup pending", async () => {
    mocks.getDummySeedFilesystemStatus.mockResolvedValue(
      DAMAGED_FILESYSTEM
    );
    mocks.getDummySeedStatus.mockResolvedValue({
      seeded: true,
      databaseComplete: true,
      databasePresent: true,
      incomplete: false,
      ordersCount: 4,
      studiesCount: 2,
      samplesCount: 10,
      readsCount: 12,
      samplesWithSeedMetadataCount: 10,
      sampleMetadataComplete: true,
      readPathsComplete: true,
      ordersByStatus: { SUBMITTED: 3, DRAFT: 1 },
      storedDataBasePath: dataBasePath,
      pendingCleanupDataBasePath: null,
      storagePathConflict: false,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      seeded: false,
      databaseComplete: true,
      filesPresent: true,
      filesComplete: false,
      integrityComplete: false,
      referencedFilesCount: 22,
      validFilesCount: 21,
      invalidFilesCount: 1,
      cleanupPending: true,
    });
  });

  it("reports an orphaned FASTQ folder as retryable cleanup", async () => {
    mocks.getDummySeedFilesystemStatus.mockResolvedValue(
      ORPHAN_FILESYSTEM
    );

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      seeded: false,
      filesPresent: true,
      cleanupPending: true,
    });
  });

  it("reports a durable cleanup pointer from the original storage path", async () => {
    const originalStorage = path.join(dataBasePath, "original");
    const currentStorage = path.join(dataBasePath, "current");
    await fs.mkdir(originalStorage);
    await fs.mkdir(currentStorage);
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath: currentStorage,
      source: "database",
      isImplicit: false,
    });
    mocks.getDummySeedStatus.mockResolvedValue({
      seeded: false,
      databasePresent: false,
      incomplete: false,
      ordersCount: 0,
      studiesCount: 0,
      ordersByStatus: {},
      storedDataBasePath: originalStorage,
      pendingCleanupDataBasePath: originalStorage,
      storagePathConflict: false,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      fixtureDataBasePath: originalStorage,
      pendingCleanupDataBasePath: originalStorage,
      cleanupPending: true,
    });
    expect(mocks.getDummySeedFilesystemStatus).toHaveBeenCalledWith(
      "admin-1",
      originalStorage
    );
  });

  it("reports status even when sequencing storage is unconfigured", async () => {
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath: null,
      source: "none",
      isImplicit: false,
    });
    mocks.getDummySeedStatus.mockResolvedValue({
      seeded: true,
      ordersCount: 4,
      ordersByStatus: { SUBMITTED: 3, DRAFT: 1 },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      seeded: false,
      integrityComplete: false,
      cleanupPending: true,
      ordersCount: 4,
      storageReady: false,
      storageError: "Data base path not configured",
      dataBasePath: null,
    });
  });

  it("delegates POST creation to the shared seed runner", async () => {
    mocks.runDummySeed.mockResolvedValue({
      ordersCreated: 4,
      samplesCreated: 10,
      readsCreated: 12,
      filesCreated: 22,
      studyId: "study-1",
      studyScopedId: "study-2",
      dataPath: "seed-dummy/admin-1",
      syntheticReadCount: 1000,
      syntheticReadLength: 150,
      platform: {
        platform: "ILLUMINA",
        instrumentModel: "NovaSeq 6000/X",
        pairedEnd: true,
        fromConfiguredDevice: false,
      },
    });

    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      ordersCreated: 4,
      samplesCreated: 10,
      readsCreated: 12,
      filesCreated: 22,
      dataPath: "seed-dummy/admin-1",
    });
    expect(mocks.runDummySeed).toHaveBeenCalledWith({
      ownerUserId: "admin-1",
      resolvedBase: dataBasePath,
      ownerEmail: "ada@example.org",
      ownerDisplayName: "Ada Lovelace",
    });
    expect(mocks.updateAdminActivityJob).toHaveBeenLastCalledWith(
      "seed:dummy-data:admin-1",
      expect.objectContaining({
        state: "success",
        phase: "complete",
        targetPath: "seed-dummy/admin-1",
      })
    );
  });

  it("returns a conflict when this admin already has dummy data", async () => {
    mocks.runDummySeed.mockRejectedValue(
      new DummySeedAlreadyExistsError(4)
    );

    const response = await POST();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "Dummy seed data already exists for this admin. Wipe it first to re-seed.",
      ordersCount: 4,
    });
  });

  it("rejects installation when no sequencing data path is configured", async () => {
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath: null,
      source: "none",
      isImplicit: false,
    });

    const response = await POST();

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Data base path not configured",
    });
    expect(mocks.runDummySeed).not.toHaveBeenCalled();
  });

  it("rejects the filesystem root even when it is configured outside the UI", async () => {
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath: path.parse(dataBasePath).root,
      source: "environment",
      isImplicit: false,
    });

    const response = await POST();

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/filesystem root/i),
    });
    expect(mocks.runDummySeed).not.toHaveBeenCalled();
  });

  it("deletes the admin's seeded database rows and FASTQ folder", async () => {
    mocks.removeDummySeed.mockResolvedValue({
      ordersDeleted: 2,
      filesRemoved: true,
    });

    const response = await DELETE();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      ordersDeleted: 2,
      filesRemoved: true,
    });
    expect(mocks.removeDummySeed).toHaveBeenCalledWith({
      ownerUserId: "admin-1",
      resolvedBase: dataBasePath,
    });
  });

  it("keeps database fixtures after storage is unconfigured", async () => {
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath: null,
      source: "none",
      isImplicit: false,
    });
    mocks.getDummySeedStatus.mockResolvedValue({
      seeded: true,
      databasePresent: true,
      incomplete: false,
      ordersCount: 4,
      studiesCount: 2,
      ordersByStatus: { SUBMITTED: 3, DRAFT: 1 },
      storedDataBasePath: null,
      storagePathConflict: false,
    });

    const response = await DELETE();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/database rows were left intact/i),
    });
    expect(mocks.removeDummySeed).not.toHaveBeenCalled();
  });

  it("removes files from the persisted fixture path after storage is reconfigured", async () => {
    const originalStorage = path.join(dataBasePath, "original");
    const currentStorage = path.join(dataBasePath, "current");
    await fs.mkdir(originalStorage);
    await fs.mkdir(currentStorage);
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath: currentStorage,
      source: "database",
      isImplicit: false,
    });
    mocks.getDummySeedStatus.mockResolvedValue({
      seeded: true,
      databasePresent: true,
      incomplete: false,
      ordersCount: 4,
      studiesCount: 2,
      ordersByStatus: { SUBMITTED: 3, DRAFT: 1 },
      storedDataBasePath: originalStorage,
      storagePathConflict: false,
    });

    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(mocks.removeDummySeed).toHaveBeenCalledWith({
      ownerUserId: "admin-1",
      resolvedBase: originalStorage,
    });
  });

  it("retries a durable cleanup pointer after fixture rows are gone", async () => {
    const originalStorage = path.join(dataBasePath, "cleanup-original");
    const currentStorage = path.join(dataBasePath, "cleanup-current");
    await fs.mkdir(originalStorage);
    await fs.mkdir(currentStorage);
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath: currentStorage,
      source: "database",
      isImplicit: false,
    });
    mocks.getDummySeedStatus.mockResolvedValue({
      seeded: false,
      databasePresent: false,
      incomplete: false,
      ordersCount: 0,
      studiesCount: 0,
      ordersByStatus: {},
      storedDataBasePath: originalStorage,
      pendingCleanupDataBasePath: originalStorage,
      storagePathConflict: false,
    });

    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(mocks.removeDummySeed).toHaveBeenCalledWith({
      ownerUserId: "admin-1",
      resolvedBase: originalStorage,
    });
  });

  it("retains an unavailable durable cleanup pointer for a later retry", async () => {
    const missingOriginal = path.join(dataBasePath, "missing-original");
    const currentStorage = path.join(dataBasePath, "available-current");
    await fs.mkdir(currentStorage);
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath: currentStorage,
      source: "database",
      isImplicit: false,
    });
    mocks.getDummySeedStatus.mockResolvedValue({
      seeded: false,
      databasePresent: false,
      incomplete: false,
      ordersCount: 0,
      studiesCount: 0,
      ordersByStatus: {},
      storedDataBasePath: missingOriginal,
      pendingCleanupDataBasePath: missingOriginal,
      storagePathConflict: false,
    });

    const response = await DELETE();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/cleanup pointer was retained/i),
      fixtureDataBasePath: missingOriginal,
    });
    expect(mocks.removeDummySeed).not.toHaveBeenCalled();
  });

  it("returns a conflict instead of bypassing linked pipeline-run cleanup", async () => {
    mocks.removeDummySeed.mockRejectedValue(new DummySeedInUseError(2));

    const response = await DELETE();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "The demo dataset has 2 linked pipeline runs. Delete those runs from Pipeline Runs before removing the demo dataset.",
      pipelineRunsCount: 2,
    });
  });
});
