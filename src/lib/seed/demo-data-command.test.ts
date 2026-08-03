import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
  resolveDataBasePathFromStoredValue: vi.fn(),
  getDummySeedFilesystemStatus: vi.fn(),
  getDummySeedStatus: vi.fn(),
  removeDummySeed: vi.fn(),
  resolveWritableBase: vi.fn(),
  runDummySeed: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/files/data-base-path", () => ({
  resolveDataBasePathFromStoredValue:
    mocks.resolveDataBasePathFromStoredValue,
}));

vi.mock("./run-seed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./run-seed")>();
  return {
    ...actual,
    getDummySeedFilesystemStatus:
      mocks.getDummySeedFilesystemStatus,
    getDummySeedStatus: mocks.getDummySeedStatus,
    removeDummySeed: mocks.removeDummySeed,
    resolveWritableBase: mocks.resolveWritableBase,
    runDummySeed: mocks.runDummySeed,
  };
});

import {
  executeDemoDataCommand,
  resolveDemoDataOwner,
} from "./demo-data-command";
import { DummySeedAlreadyExistsError } from "./run-seed";

const admin = {
  id: "admin-1",
  email: "admin@example.org",
  firstName: "Ada",
  lastName: "Admin",
  role: "FACILITY_ADMIN",
};

let tempDir: string;
let configPath: string;

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

describe("installed demo-data command", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.SEQDESK_BOOTSTRAP_ADMIN_EMAIL;
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "seqdesk-demo-command-")
    );
    configPath = path.join(tempDir, "settings.json");
    await fs.writeFile(configPath, "{}");

    mocks.db.user.findUnique.mockImplementation(
      async ({ where }: { where: { email: string } }) =>
        where.email === admin.email ? admin : null
    );
    mocks.db.user.findMany.mockResolvedValue([]);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      dataBasePath: tempDir,
    });
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath: tempDir,
      source: "database",
      isImplicit: false,
    });
    mocks.resolveWritableBase.mockResolvedValue(tempDir);
    mocks.getDummySeedFilesystemStatus.mockResolvedValue(
      ABSENT_FILESYSTEM
    );
    mocks.getDummySeedStatus.mockResolvedValue({
      seeded: false,
      ordersCount: 0,
      ordersByStatus: {},
    });
    mocks.removeDummySeed.mockResolvedValue({
      ordersDeleted: 4,
      filesRemoved: true,
    });
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
  });

  afterEach(async () => {
    delete process.env.SEQDESK_BOOTSTRAP_ADMIN_EMAIL;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("delegates installation to the shared seed runner for an explicit facility admin", async () => {
    mocks.getDummySeedFilesystemStatus
      .mockResolvedValueOnce(ABSENT_FILESYSTEM)
      .mockResolvedValueOnce(HEALTHY_FILESYSTEM);
    mocks.getDummySeedStatus
      .mockResolvedValueOnce({
        seeded: false,
        ordersCount: 0,
        ordersByStatus: {},
      })
      .mockResolvedValueOnce({
        seeded: true,
        ordersCount: 4,
        ordersByStatus: { SUBMITTED: 3, DRAFT: 1 },
      });

    const result = await executeDemoDataCommand({
      action: "install",
      configPath,
      userEmail: admin.email,
    });

    expect(mocks.runDummySeed).toHaveBeenCalledWith({
      ownerUserId: admin.id,
      resolvedBase: tempDir,
      ownerEmail: admin.email,
      ownerDisplayName: "Ada Admin",
    });
    expect(result).toMatchObject({
      ok: true,
      action: "install",
      seeded: true,
      ordersCount: 4,
      ordersCreated: 4,
      samplesCreated: 10,
      readsCreated: 12,
      filesCreated: 22,
      storageReady: true,
      dataBasePath: tempDir,
      owner: {
        id: admin.id,
        email: admin.email,
        displayName: "Ada Admin",
      },
    });
  });

  it("is idempotent when the owner already has the fixture", async () => {
    mocks.getDummySeedFilesystemStatus.mockResolvedValue(
      HEALTHY_FILESYSTEM
    );
    mocks.getDummySeedStatus.mockResolvedValue({
      seeded: true,
      ordersCount: 4,
      ordersByStatus: { SUBMITTED: 3, DRAFT: 1 },
    });

    const result = await executeDemoDataCommand({
      action: "install",
      configPath,
      userEmail: admin.email,
    });

    expect(result.alreadyInstalled).toBe(true);
    expect(mocks.runDummySeed).not.toHaveBeenCalled();
  });

  it("does not treat a database-complete fixture with one damaged FASTQ as installed", async () => {
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
      storedDataBasePath: tempDir,
      pendingCleanupDataBasePath: null,
      storagePathConflict: false,
    });

    await expect(
      executeDemoDataCommand({
        action: "install",
        configPath,
        userEmail: admin.email,
      })
    ).rejects.toMatchObject({ code: "CLEANUP_PENDING" });
    expect(mocks.runDummySeed).not.toHaveBeenCalled();
  });

  it("treats a concurrent install winner as idempotent success", async () => {
    mocks.getDummySeedFilesystemStatus
      .mockResolvedValueOnce(ABSENT_FILESYSTEM)
      .mockResolvedValueOnce(HEALTHY_FILESYSTEM);
    mocks.runDummySeed.mockRejectedValue(
      new DummySeedAlreadyExistsError(4)
    );
    mocks.getDummySeedStatus
      .mockResolvedValueOnce({
        seeded: false,
        ordersCount: 0,
        ordersByStatus: {},
      })
      .mockResolvedValueOnce({
        seeded: true,
        ordersCount: 4,
        ordersByStatus: { SUBMITTED: 3, DRAFT: 1 },
      });

    const result = await executeDemoDataCommand({
      action: "install",
      configPath,
      userEmail: admin.email,
    });

    expect(result).toMatchObject({
      ok: true,
      seeded: true,
      alreadyInstalled: true,
    });
  });

  it("reports status even when storage is no longer configured", async () => {
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

    const result = await executeDemoDataCommand({
      action: "status",
      configPath,
      userEmail: admin.email,
    });

    expect(result).toMatchObject({
      ok: true,
      action: "status",
      seeded: false,
      integrityComplete: false,
      cleanupPending: true,
      storageReady: false,
      dataBasePath: null,
      storageError: expect.stringContaining("not configured"),
      message: expect.stringContaining("not configured"),
    });
  });

  it("keeps database fixtures when the old storage path is unavailable", async () => {
    const unavailablePath = path.join(tempDir, "unmounted");
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath: unavailablePath,
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
      storedDataBasePath: unavailablePath,
      storagePathConflict: false,
    });

    await expect(
      executeDemoDataCommand({
        action: "remove",
        configPath,
        userEmail: admin.email,
      })
    ).rejects.toMatchObject({ code: "STORAGE_PATH_INVALID" });
    expect(mocks.removeDummySeed).not.toHaveBeenCalled();
  });

  it("uses the persisted fixture path after configured storage changes", async () => {
    const originalStorage = path.join(tempDir, "original-storage");
    await fs.mkdir(originalStorage);
    mocks.getDummySeedStatus
      .mockResolvedValueOnce({
        seeded: true,
        databasePresent: true,
        incomplete: false,
        ordersCount: 4,
        studiesCount: 2,
        ordersByStatus: { SUBMITTED: 3, DRAFT: 1 },
        storedDataBasePath: originalStorage,
        storagePathConflict: false,
      })
      .mockResolvedValueOnce({
        seeded: false,
        databasePresent: false,
        incomplete: false,
        ordersCount: 0,
        studiesCount: 0,
        ordersByStatus: {},
        storedDataBasePath: null,
        storagePathConflict: false,
      });
    mocks.getDummySeedFilesystemStatus
      .mockResolvedValueOnce(HEALTHY_FILESYSTEM)
      .mockResolvedValueOnce(ABSENT_FILESYSTEM);

    await executeDemoDataCommand({
      action: "remove",
      configPath,
      userEmail: admin.email,
    });

    expect(mocks.removeDummySeed).toHaveBeenCalledWith({
      ownerUserId: admin.id,
      resolvedBase: originalStorage,
    });
  });

  it("retries the persisted cleanup path after fixture rows are already gone", async () => {
    const originalStorage = path.join(tempDir, "cleanup-storage");
    await fs.mkdir(originalStorage);
    mocks.getDummySeedStatus
      .mockResolvedValueOnce({
        seeded: false,
        databasePresent: false,
        incomplete: false,
        ordersCount: 0,
        studiesCount: 0,
        ordersByStatus: {},
        storedDataBasePath: originalStorage,
        pendingCleanupDataBasePath: originalStorage,
        storagePathConflict: false,
      })
      .mockResolvedValueOnce({
        seeded: false,
        databasePresent: false,
        incomplete: false,
        ordersCount: 0,
        studiesCount: 0,
        ordersByStatus: {},
        storedDataBasePath: null,
        pendingCleanupDataBasePath: null,
        storagePathConflict: false,
      });
    mocks.getDummySeedFilesystemStatus
      .mockResolvedValueOnce(ORPHAN_FILESYSTEM)
      .mockResolvedValueOnce(ABSENT_FILESYSTEM);
    mocks.removeDummySeed.mockResolvedValue({
      ordersDeleted: 0,
      ticketLinksCleared: 0,
      filesRemoved: true,
    });

    const result = await executeDemoDataCommand({
      action: "remove",
      configPath,
      userEmail: admin.email,
    });

    expect(mocks.removeDummySeed).toHaveBeenCalledWith({
      ownerUserId: admin.id,
      resolvedBase: originalStorage,
    });
    expect(result).toMatchObject({
      cleanupPending: false,
      filesPresent: false,
      filesRemoved: true,
    });
  });

  it("keeps database rows when the persisted fixture path is unavailable", async () => {
    const missingOriginal = path.join(tempDir, "missing-original");
    mocks.getDummySeedStatus.mockResolvedValue({
      seeded: true,
      databasePresent: true,
      incomplete: false,
      ordersCount: 4,
      studiesCount: 2,
      ordersByStatus: { SUBMITTED: 3, DRAFT: 1 },
      storedDataBasePath: missingOriginal,
      storagePathConflict: false,
    });

    await expect(
      executeDemoDataCommand({
        action: "remove",
        configPath,
        userEmail: admin.email,
      })
    ).rejects.toMatchObject({
      code: "STORAGE_PATH_INVALID",
    });
    expect(mocks.removeDummySeed).not.toHaveBeenCalled();
  });

  it("reports and removes an orphaned FASTQ folder after database cleanup", async () => {
    mocks.getDummySeedFilesystemStatus
      .mockResolvedValueOnce(ORPHAN_FILESYSTEM)
      .mockResolvedValueOnce(ABSENT_FILESYSTEM);
    mocks.getDummySeedStatus.mockResolvedValue({
      seeded: false,
      ordersCount: 0,
      ordersByStatus: {},
    });
    mocks.removeDummySeed.mockResolvedValue({
      ordersDeleted: 0,
      filesRemoved: true,
    });

    const result = await executeDemoDataCommand({
      action: "remove",
      configPath,
      userEmail: admin.email,
    });

    expect(mocks.removeDummySeed).toHaveBeenCalledWith({
      ownerUserId: admin.id,
      resolvedBase: tempDir,
    });
    expect(result).toMatchObject({
      seeded: false,
      filesPresent: false,
      cleanupPending: false,
      ordersDeleted: 0,
      filesRemoved: true,
    });
  });

  it("requires orphaned files to be removed before reinstalling", async () => {
    mocks.getDummySeedFilesystemStatus.mockResolvedValue(
      ORPHAN_FILESYSTEM
    );

    await expect(
      executeDemoDataCommand({
        action: "install",
        configPath,
        userEmail: admin.email,
      })
    ).rejects.toMatchObject({
      code: "CLEANUP_PENDING",
    });
    expect(mocks.runDummySeed).not.toHaveBeenCalled();
  });

  it("removes a study-only partial fixture instead of treating it as absent", async () => {
    mocks.getDummySeedStatus
      .mockResolvedValueOnce({
        seeded: false,
        databasePresent: true,
        incomplete: true,
        ordersCount: 0,
        studiesCount: 2,
        ordersByStatus: {},
      })
      .mockResolvedValueOnce({
        seeded: false,
        databasePresent: false,
        incomplete: false,
        ordersCount: 0,
        studiesCount: 0,
        ordersByStatus: {},
      });
    mocks.removeDummySeed.mockResolvedValue({
      ordersDeleted: 0,
      ticketLinksCleared: 0,
      filesRemoved: false,
    });

    const result = await executeDemoDataCommand({
      action: "remove",
      configPath,
      userEmail: admin.email,
    });

    expect(mocks.removeDummySeed).toHaveBeenCalled();
    expect(result).toMatchObject({
      databasePresent: false,
      incomplete: false,
    });
    expect(result.alreadyAbsent).not.toBe(true);
  });

  it("requires an explicit owner when several admins are plausible", async () => {
    mocks.db.user.findUnique.mockResolvedValue(null);
    mocks.db.user.findMany.mockResolvedValue([
      { ...admin, role: undefined },
      {
        id: "admin-2",
        email: "second@example.org",
        firstName: "Second",
        lastName: "Admin",
      },
    ]);

    await expect(
      resolveDemoDataOwner({ configPath })
    ).rejects.toMatchObject({
      code: "MULTIPLE_FACILITY_ADMINS",
    });
  });

  it("uses the configured bootstrap admin before database ordering", async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({
        bootstrap: {
          users: {
            admin: { email: admin.email },
          },
        },
      })
    );

    const owner = await resolveDemoDataOwner({ configPath });

    expect(owner).toMatchObject({ id: admin.id, email: admin.email });
    expect(mocks.db.user.findMany).not.toHaveBeenCalled();
  });

  it("rejects installation before seeding when storage is unavailable", async () => {
    const unavailablePath = path.join(tempDir, "missing-storage");
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath: unavailablePath,
      source: "database",
      isImplicit: false,
    });

    await expect(
      executeDemoDataCommand({
        action: "install",
        configPath,
        userEmail: admin.email,
      })
    ).rejects.toMatchObject({
      code: "STORAGE_PATH_INVALID",
    });
    expect(mocks.runDummySeed).not.toHaveBeenCalled();
  });
});
