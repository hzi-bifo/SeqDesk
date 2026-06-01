import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { gunzipSync } from "zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    order: {
      count: vi.fn(),
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
  resolveWritableBase,
  runDummySeed,
} from "./run-seed";
import {
  PLATFORM_ILLUMINA_NOVASEQ_WGS,
  PLATFORM_ONT_MINION_WGS,
} from "./templates";

let tempDir: string;

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
    study: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `study-${createdStudies.length + 1}`;
        createdStudies.push({ id, ...data });
        return { id };
      }),
    },
    order: {
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
    mocks.db.order.count.mockResolvedValue(0);
    // selectPlatformForSeed + setDummyDataEnabledFlag both read siteSettings.
    mocks.db.siteSettings.findUnique.mockResolvedValue({ extraSettings: null });
    mocks.db.siteSettings.update.mockResolvedValue({});
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    delete process.env.SEQDESK_SEED_READ_COUNT;
    delete process.env.SEQDESK_SEED_READ_LENGTH;
  });

  it("throws DummySeedAlreadyExistsError when the owner already has seeded orders", async () => {
    mocks.db.order.count.mockResolvedValue(3);

    await expect(
      runDummySeed({ ownerUserId: "user-1", resolvedBase: tempDir })
    ).rejects.toBeInstanceOf(DummySeedAlreadyExistsError);

    expect(mocks.db.$transaction).not.toHaveBeenCalled();
    // No FASTQ folder should have been created.
    const entries = await fs.readdir(tempDir);
    expect(entries).toEqual([]);
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
    expect(result.samplesCreated).toBeGreaterThan(0);
    expect(result.readsCreated).toBeGreaterThan(0);
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

    // Best-effort flag persistence ran.
    expect(mocks.db.siteSettings.update).toHaveBeenCalled();
  });

  it("defaults contact name and skips the flag update when there is no SiteSettings row", async () => {
    const { tx, createdOrders } = buildTransactionStub();
    mocks.db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    // setDummyDataEnabledFlag no-ops (no row) but selectPlatformForSeed still needs a value.
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);

    await runDummySeed({
      ownerUserId: "user-1",
      resolvedBase: tempDir,
      syntheticReadCount: 3,
      syntheticReadLength: 28,
    });

    expect(createdOrders[0].contactName).toBe("Seed Dummy Data");
    expect(createdOrders[0].contactEmail).toBeNull();
    // No SiteSettings row => setDummyDataEnabledFlag returns before updating.
    expect(mocks.db.siteSettings.update).not.toHaveBeenCalled();
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
});
