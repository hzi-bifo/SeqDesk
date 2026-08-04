import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { gunzipSync, gzipSync } from "zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    order: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    study: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    read: {
      findMany: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import {
  DummySeedAlreadyExistsError,
  DummySeedCleanupPendingError,
  DummySeedInUseError,
  DummySeedReferencesError,
  DummySeedStorageMismatchError,
  DummySeedSubmissionError,
  getDummySeedFilesPresent,
  getDummySeedFilesystemStatus,
  getDummySeedStatus,
  removeDummySeed,
  resolveWritableBase,
  runDummySeed,
} from "./run-seed";
import {
  PLATFORM_ILLUMINA_NOVASEQ_WGS,
  PLATFORM_ONT_MINION_WGS,
} from "./templates";

let tempDir: string;

function buildCompleteStatusOrders(dataBasePath: string) {
  const sampleCountsByOrder = [3, 2, 2, 3];
  const readCountsBySample = [2, 2, 1, 1, 1, 1, 1, 1, 1, 1];
  let sampleIndex = 0;
  let readIndex = 0;

  return sampleCountsByOrder.map((sampleCount, orderIndex) => ({
    status: orderIndex === 3 ? "DRAFT" : "SUBMITTED",
    customFields: JSON.stringify({
      seedSource: "admin-dummy",
      seedDataBasePath: dataBasePath,
    }),
    samples: Array.from({ length: sampleCount }, () => {
      const currentSampleIndex = sampleIndex++;
      return {
        customFields: JSON.stringify({
          seedSource: "admin-dummy",
          fixture: true,
        }),
        checklistData: JSON.stringify({
          scientific_name: `Example organism ${currentSampleIndex + 1}`,
        }),
        reads: Array.from(
          { length: readCountsBySample[currentSampleIndex] },
          () => ({
            file1: `seed-dummy/owner-1/read-${++readIndex}.fastq.gz`,
            file2: null,
          })
        ),
      };
    }),
  }));
}

function buildSeedStudies(dataBasePath: string) {
  return Array.from({ length: 2 }, () => ({
    studyMetadata: JSON.stringify({
      seedSource: "admin-dummy",
      seedDataBasePath: dataBasePath,
    }),
  }));
}

/**
 * A minimal transaction stub that records every created study/order and returns
 * shapes runDummySeed depends on (study.id + order.samples[].reads). The order
 * create returns the same sample/read counts that were requested so the summary
 * counters reflect the dataset.
 */
function buildTransactionStub() {
  const createdStudies: Array<Record<string, unknown>> = [];
  const createdOrders: Array<Record<string, unknown>> = [];

  const tx = {
    $queryRaw: vi.fn(async () => 1),
    siteSettings: {
      findUnique: vi.fn(
        async (): Promise<{ extraSettings: string | null } | null> => ({
          extraSettings: null,
        })
      ),
      update: vi.fn(async () => ({})),
    },
    study: {
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `study-${createdStudies.length + 1}`;
        createdStudies.push({ id, ...data });
        return { id };
      }),
    },
    order: {
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `order-${createdOrders.length + 1}`;
        createdOrders.push({ id, ...data });
        const sampleCreates =
          (data.samples as { create: Array<Record<string, unknown>> }).create ?? [];
        const samples = sampleCreates.map((sample, sampleIndex) => {
          const readCreates =
            (sample.reads as { create: Array<Record<string, unknown>> } | undefined)
              ?.create ?? [];
          return {
            id: `${id}-sample-${sampleIndex}`,
            reads: readCreates.map((_, readIndex) => ({
              id: `${id}-sample-${sampleIndex}-read-${readIndex}`,
            })),
          };
        });
        return { id, samples };
      }),
    },
  };

  return { tx, createdStudies, createdOrders };
}

describe("runDummySeed", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-seed-test-"));
    // selectPlatformForSeed + setDummyDataEnabledFlag both read siteSettings.
    mocks.db.siteSettings.findUnique.mockResolvedValue({ extraSettings: null });
    mocks.db.siteSettings.update.mockResolvedValue({});
    mocks.db.study.findMany.mockResolvedValue([]);
    mocks.db.study.count.mockResolvedValue(0);
    mocks.db.read.findMany.mockResolvedValue([]);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    delete process.env.SEQDESK_SEED_READ_COUNT;
    delete process.env.SEQDESK_SEED_READ_LENGTH;
  });

  it("throws DummySeedAlreadyExistsError when the owner already has seeded orders", async () => {
    const { tx } = buildTransactionStub();
    tx.order.count.mockResolvedValue(3);
    mocks.db.$transaction.mockImplementation(
      async (fn: (t: typeof tx) => unknown) => fn(tx)
    );

    await expect(
      runDummySeed({ ownerUserId: "user-1", resolvedBase: tempDir })
    ).rejects.toBeInstanceOf(DummySeedAlreadyExistsError);

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.study.create).not.toHaveBeenCalled();
    // No FASTQ folder should have been created.
    const entries = await fs.readdir(tempDir);
    expect(entries).toEqual([]);
  });

  it("blocks installation while a durable cleanup pointer remains", async () => {
    const { tx } = buildTransactionStub();
    tx.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        dummyDataCleanupPaths: {
          "user-1": tempDir,
        },
      }),
    });
    mocks.db.$transaction.mockImplementation(
      async (fn: (t: typeof tx) => unknown) => fn(tx)
    );

    await expect(
      runDummySeed({ ownerUserId: "user-1", resolvedBase: tempDir })
    ).rejects.toBeInstanceOf(DummySeedCleanupPendingError);
    expect(tx.order.count).not.toHaveBeenCalled();
    expect(tx.study.create).not.toHaveBeenCalled();
  });

  it("writes synthetic FASTQ files and creates the linked studies/orders", async () => {
    const { tx, createdStudies, createdOrders } = buildTransactionStub();
    mocks.db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));

    const result = await runDummySeed({
      ownerUserId: "user-1",
      resolvedBase: tempDir,
      ownerEmail: "owner@example.org",
      ownerDisplayName: "Owner Person",
      syntheticReadCount: 5,
      syntheticReadLength: 30,
    });

    // Two studies (primary gut-recovery + study-scoped) and four seeded orders.
    expect(createdStudies).toHaveLength(2);
    expect(createdOrders).toHaveLength(4);
    expect(result.ordersCreated).toBe(4);
    expect(result.studyId).toBe("study-1");
    expect(result.studyScopedId).toBe("study-2");
    expect(result.samplesCreated).toBe(10);
    expect(result.readsCreated).toBe(12);
    expect(result.filesCreated).toBeGreaterThan(0);

    // The resolved synthetic sizes flow through from the explicit options.
    expect(result.syntheticReadCount).toBe(5);
    expect(result.syntheticReadLength).toBe(30);

    // The FASTQ folder exists with at least one gzipped FASTQ on disk.
    const fastqDir = path.join(tempDir, result.dataPath);
    const files = await fs.readdir(fastqDir);
    expect(files.length).toBe(result.filesCreated);
    const firstGz = files.find((f) => f.endsWith(".fastq.gz"));
    expect(firstGz).toBeDefined();
    const decompressed = gunzipSync(
      await fs.readFile(path.join(fastqDir, firstGz!))
    ).toString("utf-8");
    expect(decompressed.startsWith("@SIM:")).toBe(true);

    // Contact details propagate to the created orders.
    expect(createdOrders[0].contactName).toBe("Owner Person");
    expect(createdOrders[0].contactEmail).toBe("owner@example.org");
    const createdSamples = createdOrders.flatMap(
      (order) =>
        (
          order.samples as {
            create: Array<Record<string, unknown>>;
          }
        ).create
    );
    expect(createdSamples.length).toBeGreaterThan(0);
    expect(
      createdSamples.every(
        (sample) =>
          sample.facilityStatus === "SEQUENCED" &&
          sample.facilityStatusUpdatedAt instanceof Date
      )
    ).toBe(true);

    // Best-effort flag persistence ran.
    expect(tx.siteSettings.update).toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.order.count.mock.invocationCallOrder[0]
    );
  });

  it("defaults contact name and skips the flag update when there is no SiteSettings row", async () => {
    const { tx, createdOrders } = buildTransactionStub();
    mocks.db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    // setDummyDataEnabledFlag no-ops (no row) but selectPlatformForSeed still needs a value.
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    tx.siteSettings.findUnique.mockResolvedValue(null);

    await runDummySeed({
      ownerUserId: "user-1",
      resolvedBase: tempDir,
      syntheticReadCount: 3,
      syntheticReadLength: 28,
    });

    expect(createdOrders[0].contactName).toBe("Seed Dummy Data");
    expect(createdOrders[0].contactEmail).toBeNull();
    // No SiteSettings row => setDummyDataEnabledFlag returns before updating.
    expect(tx.siteSettings.update).not.toHaveBeenCalled();
  });

  it("uses a configured ONT device for the primary platform when one is enabled", async () => {
    const { tx } = buildTransactionStub();
    mocks.db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        sequencingTechConfig: {
          devices: [
            {
              id: "dev-1",
              name: "MinION Mk1D",
              platformId: "ont-minion",
              available: true,
              comingSoon: false,
              order: 0,
            },
          ],
        },
      }),
    });

    const result = await runDummySeed({
      ownerUserId: "user-1",
      resolvedBase: tempDir,
      syntheticReadCount: 4,
      syntheticReadLength: 30,
    });

    expect(result.platform.platform).toBe(PLATFORM_ONT_MINION_WGS.platform);
    expect(result.platform.instrumentModel).toBe("MinION Mk1D");
    expect(result.platform.pairedEnd).toBe(false);
    expect(result.platform.fromConfiguredDevice).toBe(true);
  });

  it("falls back to the short-read Illumina profile when nothing is configured", async () => {
    const { tx } = buildTransactionStub();
    mocks.db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));

    const result = await runDummySeed({
      ownerUserId: "user-1",
      resolvedBase: tempDir,
      syntheticReadCount: 3,
      syntheticReadLength: 28,
    });

    expect(result.platform.platform).toBe(PLATFORM_ILLUMINA_NOVASEQ_WGS.platform);
    expect(result.platform.pairedEnd).toBe(true);
    expect(result.platform.fromConfiguredDevice).toBe(false);
  });

  it("honours the SEQDESK_SEED_READ_COUNT/LENGTH env vars when no options are given", async () => {
    const { tx } = buildTransactionStub();
    mocks.db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    process.env.SEQDESK_SEED_READ_COUNT = "7";
    process.env.SEQDESK_SEED_READ_LENGTH = "33";

    const result = await runDummySeed({
      ownerUserId: "user-1",
      resolvedBase: tempDir,
    });

    expect(result.syntheticReadCount).toBe(7);
    expect(result.syntheticReadLength).toBe(33);
  });

  it("cleans up written FASTQ files when the DB transaction fails", async () => {
    const { tx } = buildTransactionStub();
    mocks.db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => {
      // Let file writes happen first, then blow up inside the transaction.
      await fn(tx);
      throw new Error("transaction boom");
    });

    await expect(
      runDummySeed({
        ownerUserId: "user-1",
        resolvedBase: tempDir,
        syntheticReadCount: 3,
        syntheticReadLength: 28,
      })
    ).rejects.toThrow("transaction boom");

    // The FASTQ folder should have been removed on the failure path.
    const fastqDir = path.join(tempDir, "seed-dummy", "user-1");
    await expect(fs.stat(fastqDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to overwrite an orphaned deterministic FASTQ folder", async () => {
    const { tx } = buildTransactionStub();
    mocks.db.$transaction.mockImplementation(
      async (fn: (t: typeof tx) => unknown) => fn(tx)
    );
    const fastqDir = path.join(tempDir, "seed-dummy", "user-1");
    await fs.mkdir(fastqDir, { recursive: true });
    await fs.writeFile(path.join(fastqDir, "orphan.fastq.gz"), "keep");

    await expect(
      runDummySeed({
        ownerUserId: "user-1",
        resolvedBase: tempDir,
      })
    ).rejects.toBeInstanceOf(DummySeedCleanupPendingError);

    await expect(
      fs.readFile(path.join(fastqDir, "orphan.fastq.gz"), "utf8")
    ).resolves.toBe("keep");
    expect(tx.study.create).not.toHaveBeenCalled();
  });
});

describe("resolveWritableBase", () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-base-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("returns null for empty input", async () => {
    expect(await resolveWritableBase(null)).toBeNull();
    expect(await resolveWritableBase(undefined)).toBeNull();
    expect(await resolveWritableBase("")).toBeNull();
  });

  it("returns the resolved absolute path for a writable directory", async () => {
    const resolved = await resolveWritableBase(tempDir);
    expect(resolved).toBe(path.resolve(tempDir));
  });

  it("returns null when the path is a file, not a directory", async () => {
    const filePath = path.join(tempDir, "afile.txt");
    await fs.writeFile(filePath, "content");
    expect(await resolveWritableBase(filePath)).toBeNull();
  });

  it("returns null when the path does not exist", async () => {
    expect(await resolveWritableBase(path.join(tempDir, "nope"))).toBeNull();
  });

  it("rejects the filesystem root as demo-data storage", async () => {
    expect(
      await resolveWritableBase(path.parse(tempDir).root)
    ).toBeNull();
  });
});

describe("dummy seed lifecycle helpers", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "seqdesk-seed-lifecycle-")
    );
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({ unrelated: true }),
    });
    mocks.db.siteSettings.update.mockResolvedValue({});
    mocks.db.order.count.mockResolvedValue(0);
    mocks.db.study.findMany.mockResolvedValue([]);
    mocks.db.study.count.mockResolvedValue(0);
    mocks.db.read.findMany.mockResolvedValue([]);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("finds fixtures by their immutable seed marker instead of mutable order numbers", async () => {
    mocks.db.order.findMany.mockResolvedValue([
      { status: "SUBMITTED", customFields: null, samples: [] },
      { status: "SUBMITTED", customFields: null, samples: [] },
      { status: "DRAFT", customFields: null, samples: [] },
    ]);

    const result = await getDummySeedStatus("owner-1");

    expect(result).toEqual({
      seeded: false,
      databaseComplete: false,
      databasePresent: true,
      incomplete: true,
      ordersCount: 3,
      studiesCount: 0,
      samplesCount: 0,
      readsCount: 0,
      samplesWithSeedMetadataCount: 0,
      sampleMetadataComplete: false,
      readPathsComplete: false,
      ordersByStatus: { SUBMITTED: 2, DRAFT: 1 },
      storedDataBasePath: null,
      pendingCleanupDataBasePath: null,
      storagePathConflict: false,
    });
    expect(mocks.db.order.findMany).toHaveBeenCalledWith({
      where: {
        userId: "owner-1",
        customFields: { contains: '"seedSource":"admin-dummy"' },
      },
      select: {
        status: true,
        customFields: true,
        samples: {
          select: {
            customFields: true,
            checklistData: true,
            reads: {
              select: { file1: true, file2: true },
            },
          },
        },
      },
    });
    expect(mocks.db.study.findMany).toHaveBeenCalledWith({
      where: {
        userId: "owner-1",
        studyMetadata: { contains: '"seedSource":"admin-dummy"' },
      },
      select: { studyMetadata: true },
    });
  });

  it("persists and recovers the original storage base for later cleanup", async () => {
    mocks.db.order.findMany.mockResolvedValue(
      buildCompleteStatusOrders(tempDir)
    );
    mocks.db.study.findMany.mockResolvedValue(buildSeedStudies(tempDir));

    await expect(getDummySeedStatus("owner-1")).resolves.toMatchObject({
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
      storedDataBasePath: tempDir,
      storagePathConflict: false,
    });
  });

  it("reports an otherwise seeded database as incomplete when one sample is missing", async () => {
    const orders = buildCompleteStatusOrders(tempDir);
    orders[3].samples.pop();
    mocks.db.order.findMany.mockResolvedValue(orders);
    mocks.db.study.findMany.mockResolvedValue(buildSeedStudies(tempDir));

    await expect(getDummySeedStatus("owner-1")).resolves.toMatchObject({
      seeded: false,
      databaseComplete: false,
      databasePresent: true,
      incomplete: true,
      ordersCount: 4,
      studiesCount: 2,
      samplesCount: 9,
      readsCount: 11,
      sampleMetadataComplete: false,
      readPathsComplete: false,
    });
  });

  it("reports an otherwise seeded database as incomplete when one Read row is missing", async () => {
    const orders = buildCompleteStatusOrders(tempDir);
    orders[0].samples[0].reads.pop();
    mocks.db.order.findMany.mockResolvedValue(orders);
    mocks.db.study.findMany.mockResolvedValue(buildSeedStudies(tempDir));

    await expect(getDummySeedStatus("owner-1")).resolves.toMatchObject({
      seeded: false,
      databaseComplete: false,
      databasePresent: true,
      incomplete: true,
      samplesCount: 10,
      readsCount: 11,
      sampleMetadataComplete: true,
      readPathsComplete: false,
    });
  });

  it("requires the seeded marker and checklist metadata on every sample", async () => {
    const orders = buildCompleteStatusOrders(tempDir);
    orders[0].samples[0].checklistData = "{}";
    mocks.db.order.findMany.mockResolvedValue(orders);
    mocks.db.study.findMany.mockResolvedValue(buildSeedStudies(tempDir));

    await expect(getDummySeedStatus("owner-1")).resolves.toMatchObject({
      seeded: false,
      databaseComplete: false,
      samplesCount: 10,
      samplesWithSeedMetadataCount: 9,
      sampleMetadataComplete: false,
    });
  });

  it("reports a conflict when fixture rows and the cleanup pointer disagree", async () => {
    const otherStorage = await fs.mkdtemp(
      path.join(os.tmpdir(), "seqdesk-seed-conflict-")
    );
    mocks.db.order.findMany.mockResolvedValue(
      buildCompleteStatusOrders(tempDir)
    );
    mocks.db.study.findMany.mockResolvedValue(buildSeedStudies(tempDir));
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        dummyDataCleanupPaths: {
          "owner-1": otherStorage,
        },
      }),
    });

    await expect(getDummySeedStatus("owner-1")).resolves.toMatchObject({
      databasePresent: true,
      storedDataBasePath: null,
      pendingCleanupDataBasePath: otherStorage,
      storagePathConflict: true,
    });

    await fs.rm(otherStorage, { recursive: true, force: true });
  });

  function buildRemovalTransaction(options: {
    pipelineRunsCount?: number;
    failOrderDelete?: boolean;
    emptyFixture?: boolean;
    externalSamplesCount?: number;
    submissionsCount?: number;
    submittedStudy?: boolean;
    storedBasePath?: string;
  } = {}) {
    let extraSettings: string | null = JSON.stringify({ unrelated: true });
    return {
      $queryRaw: vi.fn(async () => 1),
      siteSettings: {
        findUnique: vi.fn(async () => ({ extraSettings })),
        update: vi.fn(
          async (args: { data: { extraSettings: string } }) => {
            extraSettings = args.data.extraSettings;
            return {};
          }
        ),
      },
      order: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () =>
          options.emptyFixture
            ? []
            : [
                {
                  id: "order-1",
                  customFields: options.storedBasePath
                    ? JSON.stringify({
                        seedSource: "admin-dummy",
                        seedDataBasePath: options.storedBasePath,
                      })
                    : null,
                },
              ]
        ),
        deleteMany: options.failOrderDelete
          ? vi.fn(async () => {
              throw new Error("order delete failed");
            })
          : vi.fn(async () => ({ count: options.emptyFixture ? 0 : 1 })),
      },
      study: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () =>
          options.emptyFixture
            ? []
            : [
                {
                  id: "study-1",
                  submitted: options.submittedStudy ?? false,
                  studyAccessionId: options.submittedStudy ? "PRJEB1" : null,
                  studyMetadata: options.storedBasePath
                    ? JSON.stringify({
                        seedSource: "admin-dummy",
                        seedDataBasePath: options.storedBasePath,
                      })
                    : null,
                },
              ]
        ),
        deleteMany: vi.fn(async () => ({
          count: options.emptyFixture ? 0 : 1,
        })),
      },
      sample: {
        count: vi.fn(async () => options.externalSamplesCount ?? 0),
        findMany: vi.fn(async () => [
          {
            id: "sample-1",
            sampleId: "SAMPLE-1",
            sampleAccessionNumber: null,
          },
        ]),
      },
      assembly: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      bin: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      pipelineRun: {
        count: vi.fn(async () => options.pipelineRunsCount ?? 0),
      },
      ticket: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      submission: {
        count: vi.fn(async () => options.submissionsCount ?? 0),
      },
    };
  }

  it("removes only fixture rows and their generated files", async () => {
    const tx = buildRemovalTransaction();
    mocks.db.$transaction.mockImplementation(
      async (fn: (client: typeof tx) => unknown) => fn(tx)
    );
    const seedFolder = path.join(tempDir, "seed-dummy", "owner-1");
    await fs.mkdir(seedFolder, { recursive: true });
    await fs.writeFile(path.join(seedFolder, "reads.fastq.gz"), "fixture");

    const result = await removeDummySeed({
      ownerUserId: "owner-1",
      resolvedBase: tempDir,
    });

    expect(result).toEqual({
      ordersDeleted: 1,
      ticketLinksCleared: 2,
      filesRemoved: true,
    });
    expect(tx.assembly.deleteMany).toHaveBeenCalledWith({
      where: {
        sampleId: { in: ["sample-1"] },
      },
    });
    expect(tx.bin.deleteMany).toHaveBeenCalledWith({
      where: {
        sampleId: { in: ["sample-1"] },
      },
    });
    expect(tx.pipelineRun.count).toHaveBeenCalledWith({
      where: {
        OR: [
          { orderId: { in: ["order-1"] } },
          { studyId: { in: ["study-1"] } },
        ],
      },
    });
    expect(tx.sample.count).toHaveBeenCalledWith({
      where: {
        studyId: { in: ["study-1"] },
        orderId: { notIn: ["order-1"] },
      },
    });
    expect(tx.ticket.updateMany).toHaveBeenNthCalledWith(1, {
      where: { studyId: { in: ["study-1"] } },
      data: { studyId: null },
    });
    expect(tx.ticket.updateMany).toHaveBeenNthCalledWith(2, {
      where: { orderId: { in: ["order-1"] } },
      data: { orderId: null },
    });
    expect(tx.order.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["order-1"] } },
    });
    expect(tx.study.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["study-1"] } },
    });
    await expect(fs.stat(seedFolder)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(tx.siteSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          extraSettings: JSON.stringify({
            unrelated: true,
            dummyDataEnabled: false,
          }),
        },
      })
    );
  });

  it("leaves FASTQs in place when database removal rolls back", async () => {
    const tx = buildRemovalTransaction({ failOrderDelete: true });
    mocks.db.$transaction.mockImplementation(
      async (fn: (client: typeof tx) => unknown) => fn(tx)
    );
    const seedFolder = path.join(tempDir, "seed-dummy", "owner-1");
    await fs.mkdir(seedFolder, { recursive: true });
    await fs.writeFile(path.join(seedFolder, "reads.fastq.gz"), "fixture");

    await expect(
      removeDummySeed({
        ownerUserId: "owner-1",
        resolvedBase: tempDir,
      })
    ).rejects.toThrow("order delete failed");

    await expect(fs.readFile(path.join(seedFolder, "reads.fastq.gz"), "utf8"))
      .resolves.toBe("fixture");
  });

  it("refuses removal while a linked pipeline run still exists", async () => {
    const tx = buildRemovalTransaction({ pipelineRunsCount: 2 });
    mocks.db.$transaction.mockImplementation(
      async (fn: (client: typeof tx) => unknown) => fn(tx)
    );
    const seedFolder = path.join(tempDir, "seed-dummy", "owner-1");
    await fs.mkdir(seedFolder, { recursive: true });
    await fs.writeFile(path.join(seedFolder, "reads.fastq.gz"), "fixture");

    await expect(
      removeDummySeed({
        ownerUserId: "owner-1",
        resolvedBase: tempDir,
      })
    ).rejects.toBeInstanceOf(DummySeedInUseError);

    expect(tx.order.deleteMany).not.toHaveBeenCalled();
    await expect(
      fs.readFile(path.join(seedFolder, "reads.fastq.gz"), "utf8")
    ).resolves.toBe("fixture");
  });

  it("does not delete replacement files when a reinstall wins before filesystem cleanup", async () => {
    const tx = buildRemovalTransaction();
    const cleanupTx = buildRemovalTransaction();
    cleanupTx.order.count.mockResolvedValue(4);
    cleanupTx.study.count.mockResolvedValue(2);
    mocks.db.$transaction
      .mockImplementationOnce(
        async (fn: (client: typeof tx) => unknown) => fn(tx)
      )
      .mockImplementationOnce(
        async (fn: (client: typeof cleanupTx) => unknown) =>
          fn(cleanupTx)
      );
    const seedFolder = path.join(tempDir, "seed-dummy", "owner-1");
    await fs.mkdir(seedFolder, { recursive: true });
    await fs.writeFile(path.join(seedFolder, "replacement.fastq.gz"), "new");

    const result = await removeDummySeed({
      ownerUserId: "owner-1",
      resolvedBase: tempDir,
    });

    expect(result.filesRemoved).toBe(false);
    await expect(
      fs.readFile(path.join(seedFolder, "replacement.fastq.gz"), "utf8")
    ).resolves.toBe("new");
  });

  it("retains the original cleanup path after file removal fails and clears it on retry", async () => {
    const originalStorage = await fs.mkdtemp(
      path.join(os.tmpdir(), "seqdesk-seed-original-")
    );
    const currentStorage = await fs.mkdtemp(
      path.join(os.tmpdir(), "seqdesk-seed-current-")
    );
    let persistedExtraSettings: string | null = JSON.stringify({
      unrelated: true,
      dummyDataCleanupPaths: {
        "owner-2": currentStorage,
      },
    });
    const usePersistedSettings = (
      tx: ReturnType<typeof buildRemovalTransaction>
    ) => {
      tx.siteSettings.findUnique.mockImplementation(async () => ({
        extraSettings: persistedExtraSettings,
      }));
      tx.siteSettings.update.mockImplementation(
        async (args: { data: { extraSettings: string } }) => {
          persistedExtraSettings = args.data.extraSettings;
          return {};
        }
      );
    };
    mocks.db.siteSettings.findUnique.mockImplementation(async () => ({
      extraSettings: persistedExtraSettings,
    }));
    mocks.db.siteSettings.update.mockImplementation(
      async (args: { data: { extraSettings: string } }) => {
        persistedExtraSettings = args.data.extraSettings;
        return {};
      }
    );

    const firstTx = buildRemovalTransaction({
      storedBasePath: originalStorage,
    });
    usePersistedSettings(firstTx);
    mocks.db.$transaction.mockImplementation(
      async (fn: (client: typeof firstTx) => unknown) => fn(firstTx)
    );
    const removalFailure = Object.assign(
      new Error("fixture directory is busy"),
      { code: "EBUSY" }
    );

    await expect(
      removeDummySeed({
        ownerUserId: "owner-1",
        resolvedBase: originalStorage,
        removeFolder: async () => {
          throw removalFailure;
        },
      })
    ).resolves.toMatchObject({ filesRemoved: false });

    mocks.db.order.findMany.mockResolvedValue([]);
    mocks.db.study.findMany.mockResolvedValue([]);
    await expect(getDummySeedStatus("owner-1")).resolves.toMatchObject({
      databasePresent: false,
      storedDataBasePath: originalStorage,
      pendingCleanupDataBasePath: originalStorage,
      storagePathConflict: false,
    });
    expect(originalStorage).not.toBe(currentStorage);

    const retryTx = buildRemovalTransaction({ emptyFixture: true });
    usePersistedSettings(retryTx);
    mocks.db.$transaction.mockImplementation(
      async (fn: (client: typeof retryTx) => unknown) => fn(retryTx)
    );
    const retryRemove = vi.fn(async () => {});

    await expect(
      removeDummySeed({
        ownerUserId: "owner-1",
        resolvedBase: originalStorage,
        removeFolder: retryRemove,
      })
    ).resolves.toMatchObject({ filesRemoved: true });
    expect(retryRemove).toHaveBeenCalledWith(
      path.join(originalStorage, "seed-dummy", "owner-1")
    );
    await expect(getDummySeedStatus("owner-1")).resolves.toMatchObject({
      databasePresent: false,
      storedDataBasePath: null,
      pendingCleanupDataBasePath: null,
    });
    expect(JSON.parse(persistedExtraSettings!)).toMatchObject({
      unrelated: true,
      dummyDataCleanupPaths: {
        "owner-2": currentStorage,
      },
      dummyDataEnabled: false,
    });

    await fs.rm(originalStorage, { recursive: true, force: true });
    await fs.rm(currentStorage, { recursive: true, force: true });
  });

  it("rejects a stale caller path when locked fixture rows point elsewhere", async () => {
    const replacementBase = await fs.mkdtemp(
      path.join(os.tmpdir(), "seqdesk-seed-replacement-")
    );
    const tx = buildRemovalTransaction({
      storedBasePath: replacementBase,
    });
    mocks.db.$transaction.mockImplementation(
      async (fn: (client: typeof tx) => unknown) => fn(tx)
    );

    await expect(
      removeDummySeed({
        ownerUserId: "owner-1",
        resolvedBase: tempDir,
      })
    ).rejects.toBeInstanceOf(DummySeedStorageMismatchError);
    expect(tx.order.deleteMany).not.toHaveBeenCalled();

    await fs.rm(replacementBase, { recursive: true, force: true });
  });

  it("refuses removal when unrelated samples reference a seeded study", async () => {
    const tx = buildRemovalTransaction({
      externalSamplesCount: 1,
    });
    mocks.db.$transaction.mockImplementation(
      async (fn: (client: typeof tx) => unknown) => fn(tx)
    );

    await expect(
      removeDummySeed({
        ownerUserId: "owner-1",
        resolvedBase: tempDir,
      })
    ).rejects.toBeInstanceOf(DummySeedReferencesError);
    expect(tx.order.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses removal when ENA submission history or accessions exist", async () => {
    const tx = buildRemovalTransaction({
      submissionsCount: 1,
      submittedStudy: true,
    });
    mocks.db.$transaction.mockImplementation(
      async (fn: (client: typeof tx) => unknown) => fn(tx)
    );

    await expect(
      removeDummySeed({
        ownerUserId: "owner-1",
        resolvedBase: tempDir,
      })
    ).rejects.toBeInstanceOf(DummySeedSubmissionError);
    expect(tx.order.deleteMany).not.toHaveBeenCalled();
  });

  it("still removes database fixtures when storage is unconfigured", async () => {
    const tx = buildRemovalTransaction();
    mocks.db.$transaction.mockImplementation(
      async (fn: (client: typeof tx) => unknown) => fn(tx)
    );

    const result = await removeDummySeed({
      ownerUserId: "owner-1",
      resolvedBase: null,
    });

    expect(result).toEqual({
      ordersDeleted: 1,
      ticketLinksCleared: 2,
      filesRemoved: false,
    });
    expect(tx.order.deleteMany).toHaveBeenCalled();
    expect(tx.study.deleteMany).toHaveBeenCalled();
  });

  it("cleans up an orphaned folder even when database rows are already absent", async () => {
    const tx = buildRemovalTransaction({ emptyFixture: true });
    mocks.db.$transaction.mockImplementation(
      async (fn: (client: typeof tx) => unknown) => fn(tx)
    );
    const seedFolder = path.join(tempDir, "seed-dummy", "owner-1");
    await fs.mkdir(seedFolder, { recursive: true });
    await fs.writeFile(path.join(seedFolder, "reads.fastq.gz"), "fixture");

    expect(
      await getDummySeedFilesPresent("owner-1", tempDir)
    ).toBe(true);
    const result = await removeDummySeed({
      ownerUserId: "owner-1",
      resolvedBase: tempDir,
    });

    expect(result).toEqual({
      ordersDeleted: 0,
      ticketLinksCleared: 0,
      filesRemoved: true,
    });
    expect(await getDummySeedFilesPresent("owner-1", tempDir)).toBe(false);
    expect(tx.pipelineRun.count).not.toHaveBeenCalled();
  });

  it("validates every unique FASTQ path referenced by seeded Read rows", async () => {
    const relativeFiles = [
      "seed-dummy/owner-1/sample-1_R1.fastq.gz",
      "seed-dummy/owner-1/sample-1_R2.fastq.gz",
    ];
    mocks.db.read.findMany.mockResolvedValue([
      { file1: relativeFiles[0], file2: relativeFiles[1] },
      // Repeated paths must not inflate the integrity counters.
      { file1: relativeFiles[0], file2: null },
    ]);
    await fs.mkdir(path.join(tempDir, "seed-dummy", "owner-1"), {
      recursive: true,
    });
    for (const relativeFile of relativeFiles) {
      await fs.writeFile(
        path.join(tempDir, relativeFile),
        gzipSync("@read\nACGT\n+\nIIII\n")
      );
    }

    await expect(
      getDummySeedFilesystemStatus("owner-1", tempDir)
    ).resolves.toEqual({
      folderPresent: true,
      referencedFilesCount: 2,
      validFilesCount: 2,
      invalidFilesCount: 0,
      filesComplete: true,
    });
    expect(mocks.db.read.findMany).toHaveBeenCalledWith({
      where: {
        sample: {
          order: {
            userId: "owner-1",
            customFields: { contains: '"seedSource":"admin-dummy"' },
          },
        },
      },
      select: { file1: true, file2: true },
    });
  });

  it.each([
    ["missing", null],
    ["empty", Buffer.alloc(0)],
    ["not gzip", Buffer.from("plain FASTQ content")],
  ])(
    "reports an individual %s referenced FASTQ as invalid",
    async (_kind, invalidContents) => {
      const validRelative =
        "seed-dummy/owner-1/sample-valid_R1.fastq.gz";
      const invalidRelative =
        "seed-dummy/owner-1/sample-invalid_R1.fastq.gz";
      mocks.db.read.findMany.mockResolvedValue([
        { file1: validRelative, file2: invalidRelative },
      ]);
      await fs.mkdir(path.join(tempDir, "seed-dummy", "owner-1"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(tempDir, validRelative),
        gzipSync("@read\nACGT\n+\nIIII\n")
      );
      if (invalidContents !== null) {
        await fs.writeFile(
          path.join(tempDir, invalidRelative),
          invalidContents
        );
      }

      await expect(
        getDummySeedFilesystemStatus("owner-1", tempDir)
      ).resolves.toEqual({
        folderPresent: true,
        referencedFilesCount: 2,
        validFilesCount: 1,
        invalidFilesCount: 1,
        filesComplete: false,
      });
    }
  );

  it("treats an unreadable fixture folder as present so cleanup stays retryable", async () => {
    await expect(
      getDummySeedFilesPresent("owner-1", tempDir, {
        lstat: async () => {
          throw Object.assign(new Error("permission denied"), {
            code: "EACCES",
          });
        },
      })
    ).resolves.toBe(true);
  });
});
