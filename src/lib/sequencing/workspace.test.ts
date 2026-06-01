import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    order: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
    read: {
      update: vi.fn(),
      create: vi.fn(),
    },
    sequencingArtifact: {
      create: vi.fn(),
      update: vi.fn(),
    },
    sequencingUpload: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    sample: {
      update: vi.fn(),
    },
    streamIngestedFile: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
  },
  fs: {
    stat: vi.fn(),
  },
  files: {
    checkFileExists: vi.fn(),
    ensureWithinBase: vi.fn(),
    findFilesForSample: vi.fn(),
    hasAllowedExtension: vi.fn(),
    matchPairedEndFiles: vi.fn(),
    scanDirectory: vi.fn(),
    scanDirectoryWithReport: vi.fn(),
    safeJoin: vi.fn(),
    toRelativePath: vi.fn(),
    validateFilePair: vi.fn(),
  },
  sequencingConfig: {
    getSequencingFilesConfig: vi.fn(),
  },
  storage: {
    buildSequencingArtifactUploadRelativePath: vi.fn(),
    buildSequencingReadUploadRelativePath: vi.fn(),
    buildSequencingUploadTempRelativePath: vi.fn(),
    calculateMd5ForRelativePath: vi.fn(),
    finalizeSequencingUpload: vi.fn(),
    removeSequencingRelativePath: vi.fn(),
    statSequencingRelativePath: vi.fn(),
    writeSequencingUploadChunk: vi.fn(),
  },
  autoComplete: {
    checkAndCompleteOrder: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/files", () => ({
  checkFileExists: mocks.files.checkFileExists,
  ensureWithinBase: mocks.files.ensureWithinBase,
  findFilesForSample: mocks.files.findFilesForSample,
  hasAllowedExtension: mocks.files.hasAllowedExtension,
  matchPairedEndFiles: mocks.files.matchPairedEndFiles,
  scanDirectory: mocks.files.scanDirectory,
  scanDirectoryWithReport: mocks.files.scanDirectoryWithReport,
  safeJoin: mocks.files.safeJoin,
  toRelativePath: mocks.files.toRelativePath,
  validateFilePair: mocks.files.validateFilePair,
}));

vi.mock("@/lib/files/sequencing-config", () => ({
  getSequencingFilesConfig: mocks.sequencingConfig.getSequencingFilesConfig,
}));

vi.mock("./storage", () => ({
  buildSequencingArtifactUploadRelativePath: mocks.storage.buildSequencingArtifactUploadRelativePath,
  buildSequencingReadUploadRelativePath: mocks.storage.buildSequencingReadUploadRelativePath,
  buildSequencingUploadTempRelativePath: mocks.storage.buildSequencingUploadTempRelativePath,
  calculateMd5ForRelativePath: mocks.storage.calculateMd5ForRelativePath,
  finalizeSequencingUpload: mocks.storage.finalizeSequencingUpload,
  removeSequencingRelativePath: mocks.storage.removeSequencingRelativePath,
  statSequencingRelativePath: mocks.storage.statSequencingRelativePath,
  writeSequencingUploadChunk: mocks.storage.writeSequencingUploadChunk,
}));

vi.mock("fs/promises", () => ({
  stat: mocks.fs.stat,
}));

vi.mock("@/lib/orders/auto-complete", () => ({
  checkAndCompleteOrder: mocks.autoComplete.checkAndCompleteOrder,
}));

import {
  appendSequencingUploadChunk,
  assignOrderSequencingReads,
  cancelSequencingUpload,
  classifyOrderSequencingRead,
  completeSequencingUpload,
  computeOrderSequencingChecksums,
  createSequencingUploadSession,
  discoverOrderSequencingFiles,
  getOrderSequencingSummary,
  linkOrderSequencingArtifact,
  setOrderSequencingStatuses,
} from "./workspace";

function createOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    name: "Order 1",
    status: "COMPLETED",
    userId: "user-1",
    samples: [],
    sequencingArtifacts: [],
    ...overrides,
  };
}

function resetWorkspaceMocks() {
  vi.clearAllMocks();
  mocks.files.checkFileExists.mockResolvedValue(true);
  mocks.files.ensureWithinBase.mockImplementation((base: string, relative: string) => {
    return `${base}/${relative}`;
  });
  mocks.files.findFilesForSample.mockReturnValue({
    status: "none",
    read1: null,
    read2: null,
    confidence: 0,
    alternatives: [],
    matchedBy: null,
  });
  mocks.files.hasAllowedExtension.mockReturnValue(true);
  mocks.files.matchPairedEndFiles.mockImplementation((files: Array<{ filename: string }>) =>
    files.map((file) => ({
      identifier: file.filename.replace(/\.f(?:ast)?q(?:\.gz)?$/i, ""),
      read1: file,
      read2: null,
      isPaired: false,
    }))
  );
  mocks.files.scanDirectory.mockResolvedValue([]);
  mocks.files.scanDirectoryWithReport.mockResolvedValue({
    files: [],
    warnings: {
      inaccessibleDirectories: [],
      ignoredEntries: 0,
      truncated: false,
      activeWritesSkipped: 0,
      skippedRecentFiles: [],
      maxFiles: 10000,
      maxDepth: 4,
    },
  });
  mocks.files.safeJoin.mockImplementation((base: string, relative: string) => {
    if (relative.includes("..")) {
      throw new Error("Path traversal not allowed");
    }
    return `${base}/${relative}`;
  });
  mocks.files.toRelativePath.mockImplementation((base: string, absolute: string) => {
    const prefix = `${base}/`;
    return absolute.startsWith(prefix) ? absolute.slice(prefix.length) : absolute;
  });
  mocks.files.validateFilePair.mockReturnValue({ valid: true, errors: [] });
  mocks.sequencingConfig.getSequencingFilesConfig.mockResolvedValue({
    dataBasePath: "/data/sequencing",
    config: {
      allowedExtensions: [".fastq.gz"],
      allowSingleEnd: true,
      scanDepth: 4,
      ignorePatterns: [],
      autoAssign: false,
      activeWriteMinAgeMs: 30_000,
    },
  });
  mocks.db.read.update.mockResolvedValue({});
  mocks.db.read.create.mockResolvedValue({ id: "new-read" });
  // Default $transaction simply runs the callback with a tx mirroring db.read.
  mocks.db.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      read: {
        create: vi.fn().mockResolvedValue({ id: "new-read" }),
        update: vi.fn().mockResolvedValue({}),
      },
    })
  );
  mocks.db.sequencingArtifact.create.mockResolvedValue({});
  mocks.db.sequencingArtifact.update.mockResolvedValue({});
  mocks.db.sequencingUpload.create.mockResolvedValue({
    id: "upload-1",
    originalName: "reads.fastq.gz",
  });
  mocks.db.sequencingUpload.update.mockResolvedValue({});
  mocks.db.sequencingUpload.findUnique.mockResolvedValue(null);
  mocks.db.sample.update.mockResolvedValue({});
  mocks.db.streamIngestedFile.groupBy.mockResolvedValue([]);
  mocks.db.streamIngestedFile.findMany.mockResolvedValue([]);
  mocks.fs.stat.mockResolvedValue({
    size: 123,
    mtime: new Date("2026-03-24T09:00:00.000Z"),
  });
  mocks.autoComplete.checkAndCompleteOrder.mockResolvedValue(undefined);
  mocks.storage.buildSequencingArtifactUploadRelativePath.mockReturnValue(
    "_uploads/orders/order-1/order-artifacts/delivery/upload-1-report.html"
  );
  mocks.storage.buildSequencingReadUploadRelativePath.mockReturnValue(
    "_uploads/orders/order-1/samples/S1/reads/upload-1-R1-reads.fastq.gz"
  );
  mocks.storage.buildSequencingUploadTempRelativePath.mockReturnValue(
    "_uploads/orders/order-1/_tmp/upload-1-reads.fastq.gz.part"
  );
  mocks.storage.calculateMd5ForRelativePath.mockResolvedValue("md5-value");
  mocks.storage.finalizeSequencingUpload.mockResolvedValue(undefined);
  mocks.storage.removeSequencingRelativePath.mockResolvedValue(undefined);
  mocks.storage.statSequencingRelativePath.mockResolvedValue({
    size: BigInt(123),
    modifiedAt: new Date("2026-03-24T09:00:00.000Z"),
  });
  mocks.storage.writeSequencingUploadChunk.mockResolvedValue(undefined);
}

beforeEach(() => {
  resetWorkspaceMocks();
});

describe("assignOrderSequencingReads", () => {

  it("clears pipeline provenance when manually re-linking reads", async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      status: "COMPLETED",
      samples: [
        {
          id: "sample-1",
          sampleId: "S1",
          facilityStatus: "READY",
          reads: [
            {
              id: "read-1",
            },
          ],
        },
      ],
    });

    await assignOrderSequencingReads("order-1", [
      {
        sampleId: "sample-1",
        read1: "manual/S1_R1.fastq.gz",
        read2: "manual/S1_R2.fastq.gz",
      },
    ]);

    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-1" },
      data: expect.objectContaining({
        file1: "manual/S1_R1.fastq.gz",
        file2: "manual/S1_R2.fastq.gz",
        pipelineRunId: null,
        pipelineSources: null,
      }),
    });
  });

  it("clears pipeline provenance when reads are manually unlinked", async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      status: "COMPLETED",
      samples: [
        {
          id: "sample-1",
          sampleId: "S1",
          facilityStatus: "READY",
          reads: [
            {
              id: "read-1",
            },
          ],
        },
      ],
    });

    await assignOrderSequencingReads("order-1", [
      {
        sampleId: "sample-1",
        read1: null,
        read2: null,
      },
    ]);

    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-1" },
      data: expect.objectContaining({
        file1: null,
        file2: null,
        sequencingRunId: null,
        pipelineRunId: null,
        pipelineSources: null,
      }),
    });
  });

  it("creates a new manual read assignment with cleared pipeline provenance", async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      status: "COMPLETED",
      samples: [
        {
          id: "sample-1",
          sampleId: "S1",
          facilityStatus: "WAITING",
          reads: [],
        },
      ],
    });

    const result = await assignOrderSequencingReads("order-1", [
      {
        sampleId: "sample-1",
        read1: "manual/S1_R1.fastq.gz",
        read2: "manual/S1_R2.fastq.gz",
        checksum1: "abc123",
        checksum2: "def456",
        sequencingRunId: "seq-run-1",
      },
    ]);

    expect(result).toEqual([{ sampleId: "S1", success: true }]);
    expect(mocks.db.read.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sampleId: "sample-1",
        file1: "manual/S1_R1.fastq.gz",
        file2: "manual/S1_R2.fastq.gz",
        checksum1: "abc123",
        checksum2: "def456",
        sequencingRunId: "seq-run-1",
        pipelineRunId: null,
        pipelineSources: null,
        dataClass: "cleaned",
        dataClassSource: "associate",
        isActive: true,
      }),
    });
    expect(mocks.db.sample.update).toHaveBeenCalledWith({
      where: { id: "sample-1" },
      data: {
        facilityStatus: "SEQUENCED",
        facilityStatusUpdatedAt: expect.any(Date),
      },
    });
  });

  it("returns a validation error for invalid read pairs without touching the database", async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      status: "COMPLETED",
      samples: [
        {
          id: "sample-1",
          sampleId: "S1",
          facilityStatus: "READY",
          reads: [],
        },
      ],
    });
    mocks.files.validateFilePair.mockReturnValue({
      valid: false,
      errors: ["Read 2 requires Read 1"],
    });

    const result = await assignOrderSequencingReads("order-1", [
      {
        sampleId: "sample-1",
        read1: null,
        read2: "manual/S1_R2.fastq.gz",
      },
    ]);

    expect(result).toEqual([
      { sampleId: "S1", success: false, error: "Read 2 requires Read 1" },
    ]);
    expect(mocks.db.read.update).not.toHaveBeenCalled();
    expect(mocks.db.read.create).not.toHaveBeenCalled();
    expect(mocks.db.sample.update).not.toHaveBeenCalled();
  });

  it("returns an error when the read file is missing", async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      status: "COMPLETED",
      samples: [
        {
          id: "sample-1",
          sampleId: "S1",
          facilityStatus: "READY",
          reads: [],
        },
      ],
    });
    mocks.files.checkFileExists.mockResolvedValue(false);

    const result = await assignOrderSequencingReads("order-1", [
      {
        sampleId: "sample-1",
        read1: "manual/S1_R1.fastq.gz",
        read2: null,
      },
    ]);

    expect(result).toEqual([
      { sampleId: "S1", success: false, error: "Read 1 file not found" },
    ]);
    expect(mocks.db.read.create).not.toHaveBeenCalled();
    expect(mocks.db.sample.update).not.toHaveBeenCalled();
  });

  it("returns a sample-not-found error without touching reads", async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      status: "COMPLETED",
      samples: [],
    });

    const result = await assignOrderSequencingReads("order-1", [
      {
        sampleId: "missing-sample",
        read1: "manual/S1_R1.fastq.gz",
        read2: null,
      },
    ]);

    expect(result).toEqual([
      { sampleId: "missing-sample", success: false, error: "Sample not found" },
    ]);
    expect(mocks.db.read.update).not.toHaveBeenCalled();
    expect(mocks.db.read.create).not.toHaveBeenCalled();
  });

  it("throws when the order does not exist", async () => {
    mocks.db.order.findUnique.mockResolvedValue(null);

    await expect(assignOrderSequencingReads("order-1", [])).rejects.toThrow("Order not found");
  });
});

describe("getOrderSequencingSummary", () => {
  it("summarizes reads, qc artifacts, and missing files", async () => {
    const baseTime = new Date("2026-03-24T09:00:00.000Z");
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        sequencingArtifacts: [
          {
            id: "order-artifact-1",
            orderId: "order-1",
            sampleId: null,
            sequencingRunId: null,
            stage: "delivery",
            artifactType: "delivery_report",
            source: "linked",
            visibility: "facility",
            path: "artifacts/delivery.pdf",
            originalName: "delivery.pdf",
            size: BigInt(22),
            checksum: "artifact-md5",
            mimeType: "application/pdf",
            metadata: null,
            createdAt: baseTime,
            updatedAt: new Date("2026-03-24T09:10:00.000Z"),
          },
        ],
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            sampleAlias: "Alias 1",
            sampleTitle: "Sample 1",
            facilityStatus: "SEQUENCED",
            facilityStatusUpdatedAt: new Date("2026-03-24T09:20:00.000Z"),
            updatedAt: baseTime,
            reads: [
              {
                id: "read-1",
                file1: "reads/S1_R1.fastq.gz",
                file2: null,
                checksum1: "abc123",
                checksum2: null,
                readCount1: 10,
                readCount2: null,
                avgQuality1: 37.6,
                avgQuality2: null,
                fastqcReport1: "qc/S1.html",
                fastqcReport2: null,
                pipelineRunId: "run-1",
                pipelineSources: '{"simulate-reads":"run-1","fastqc":"run-9"}',
                pipelineRun: { runNumber: 9 },
                sequencingRun: {
                  id: "seq-1",
                  runId: "RID001",
                  runName: "Run 1",
                },
              },
            ],
            sequencingArtifacts: [
              {
                id: "sample-artifact-1",
                orderId: "order-1",
                sampleId: "sample-1",
                sequencingRunId: null,
                stage: "qc",
                artifactType: "qc_report",
                source: "upload",
                visibility: "facility",
                path: "qc/S1.html",
                originalName: "S1.html",
                size: BigInt(44),
                checksum: null,
                mimeType: "text/html",
                metadata: null,
                createdAt: baseTime,
                updatedAt: new Date("2026-03-24T09:30:00.000Z"),
              },
            ],
          },
          {
            id: "sample-2",
            sampleId: "S2",
            sampleAlias: null,
            sampleTitle: null,
            facilityStatus: "WAITING",
            facilityStatusUpdatedAt: null,
            updatedAt: baseTime,
            reads: [
              {
                id: "read-2",
                file1: "reads/S2_R1.fastq.gz",
                file2: "reads/S2_R2.fastq.gz",
                checksum1: "present",
                checksum2: null,
                readCount1: null,
                readCount2: null,
                avgQuality1: null,
                avgQuality2: null,
                fastqcReport1: null,
                fastqcReport2: null,
                pipelineRunId: null,
                pipelineSources: "not-json",
                pipelineRun: null,
                sequencingRun: null,
              },
            ],
            sequencingArtifacts: [],
          },
        ],
      })
    );
    mocks.fs.stat.mockImplementation(async (absolutePath: string) => {
      if (absolutePath.endsWith("S2_R2.fastq.gz")) {
        throw new Error("ENOENT: missing");
      }
      return {
        size: absolutePath.endsWith("S1_R1.fastq.gz") ? 111 : 222,
        mtime: baseTime,
      };
    });

    const result = await getOrderSequencingSummary("order-1");

    expect(result.summary).toEqual({
      totalSamples: 2,
      readsLinkedSamples: 2,
      qcArtifactSamples: 1,
      missingChecksumSamples: 1,
      orderArtifactCount: 1,
      statusCounts: {
        WAITING: 1,
        PROCESSING: 0,
        SEQUENCED: 1,
        QC_REVIEW: 0,
        READY: 0,
        ISSUE: 0,
      },
    });
    expect(result.samples[0].read).toEqual(
      expect.objectContaining({
        avgQuality1: 37.6,
        fileSize1: 111,
        filesMissing: false,
        pipelineRunNumber: 9,
        pipelineSources: { "simulate-reads": "run-1", fastqc: "run-9" },
        readOrigin: "simulated",
        readOriginLabel: "Simulated",
        isSimulated: true,
      })
    );
    expect(result.samples[1].read).toEqual(
      expect.objectContaining({
        fileSize1: 222,
        fileSize2: null,
        filesMissing: true,
        pipelineSources: null,
      })
    );
  });

  it("exposes planned barcode and sequencing technology context", async () => {
    const baseTime = new Date("2026-03-24T09:00:00.000Z");
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        customFields: JSON.stringify({
          _sequencing_tech: {
            technologyId: "ont",
            technologyName: "Oxford Nanopore",
          },
        }),
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            sampleAlias: null,
            sampleTitle: null,
            customFields: JSON.stringify({ _barcode: "BC9" }),
            sequencingRunSamples: [],
            facilityStatus: "WAITING",
            facilityStatusUpdatedAt: null,
            updatedAt: baseTime,
            reads: [],
            sequencingArtifacts: [],
          },
        ],
      })
    );

    const result = await getOrderSequencingSummary("order-1");

    expect(result.sequencingTechSelection).toEqual({
      id: "ont",
      name: "Oxford Nanopore",
      label: "Oxford Nanopore",
      platform: "Oxford Nanopore",
    });
    expect(result.samples[0]).toEqual(
      expect.objectContaining({
        plannedBarcode: "barcode09",
        plannedBarcodeSource: "sample-barcode",
        plannedBarcodeRunId: null,
      })
    );
  });

  it("treats traversal read paths as stale instead of resolving outside storage", async () => {
    const baseTime = new Date("2026-03-24T09:00:00.000Z");
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            sampleAlias: null,
            sampleTitle: null,
            customFields: null,
            sequencingRunSamples: [],
            facilityStatus: "SEQUENCED",
            facilityStatusUpdatedAt: null,
            updatedAt: baseTime,
            reads: [
              {
                id: "read-1",
                file1: "../outside.fastq.gz",
                file2: null,
                checksum1: null,
                checksum2: null,
                readCount1: null,
                readCount2: null,
                avgQuality1: null,
                avgQuality2: null,
                fastqcReport1: null,
                fastqcReport2: null,
                pipelineRunId: null,
                pipelineSources: null,
                pipelineRun: null,
                sequencingRun: null,
              },
            ],
            sequencingArtifacts: [],
          },
        ],
      })
    );

    const result = await getOrderSequencingSummary("order-1");

    expect(mocks.files.safeJoin).toHaveBeenCalledWith(
      "/data/sequencing",
      "../outside.fastq.gz"
    );
    expect(mocks.fs.stat).not.toHaveBeenCalled();
    expect(result.samples[0].read).toEqual(
      expect.objectContaining({ filesMissing: true })
    );
  });
});

describe("setOrderSequencingStatuses", () => {
  it("updates valid statuses and reports invalid or missing samples", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [{ id: "sample-1", sampleId: "S1" }],
      })
    );

    const result = await setOrderSequencingStatuses("order-1", [
      { sampleId: "sample-1", facilityStatus: "READY" },
      { sampleId: "missing-sample", facilityStatus: "READY" },
      { sampleId: "sample-1", facilityStatus: "NOT_A_STATUS" },
    ]);

    expect(result).toEqual([
      { sampleId: "S1", success: true },
      { sampleId: "missing-sample", success: false, error: "Sample not found" },
      { sampleId: "sample-1", success: false, error: "Invalid status" },
    ]);
    expect(mocks.db.sample.update).toHaveBeenCalledTimes(1);
    expect(mocks.db.sample.update).toHaveBeenCalledWith({
      where: { id: "sample-1" },
      data: {
        facilityStatus: "READY",
        facilityStatusUpdatedAt: expect.any(Date),
      },
    });
  });
});

describe("discoverOrderSequencingFiles", () => {
  it("auto-assigns exact matches and skips existing assignments unless forced", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            sampleAlias: null,
            sampleTitle: null,
            facilityStatus: "READY",
            reads: [{ id: "read-1", file1: "reads/existing.fastq.gz", file2: null }],
          },
          {
            id: "sample-2",
            sampleId: "S2",
            sampleAlias: "alias-2",
            sampleTitle: "Sample 2",
            facilityStatus: "WAITING",
            reads: [],
          },
        ],
      })
    );
    mocks.files.scanDirectoryWithReport.mockResolvedValue({
      files: [
        { relativePath: "reads/S2_R1.fastq.gz", filename: "S2_R1.fastq.gz" },
        { relativePath: "reads/S2_R2.fastq.gz", filename: "S2_R2.fastq.gz" },
      ],
      warnings: {
        inaccessibleDirectories: [],
        ignoredEntries: 0,
        truncated: false,
        activeWritesSkipped: 0,
        skippedRecentFiles: [],
        maxFiles: 10000,
        maxDepth: 4,
      },
    });
    mocks.files.findFilesForSample.mockReturnValue({
      status: "exact",
      read1: { relativePath: "reads/S2_R1.fastq.gz", filename: "S2_R1.fastq.gz" },
      read2: { relativePath: "reads/S2_R2.fastq.gz", filename: "S2_R2.fastq.gz" },
      confidence: 0.95,
      matchedBy: "sampleId",
      alternatives: [
        {
          identifier: "alt-1",
          read1: { relativePath: "alt/S2_R1.fastq.gz", filename: "S2_R1.fastq.gz" },
          read2: null,
        },
      ],
    });

    const result = await discoverOrderSequencingFiles("order-1", { autoAssign: true });

    expect(mocks.files.scanDirectoryWithReport).toHaveBeenCalledWith(
      "/data/sequencing",
      {
        allowedExtensions: [".fastq.gz"],
        maxDepth: 4,
        ignorePatterns: [],
        maxFiles: 10000,
        activeWriteMinAgeMs: 30_000,
      },
      false
    );
    expect(mocks.files.findFilesForSample).toHaveBeenCalledTimes(1);
    expect(mocks.db.read.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sampleId: "sample-2",
        file1: "reads/S2_R1.fastq.gz",
        file2: "reads/S2_R2.fastq.gz",
        checksum1: null,
        checksum2: null,
        sequencingRunId: null,
        pipelineRunId: null,
        pipelineSources: null,
        dataClass: "cleaned",
        dataClassSource: "associate",
        isActive: true,
      }),
    });
    expect(result.summary).toEqual({
      total: 2,
      exactMatches: 2,
      partialMatches: 0,
      ambiguous: 0,
      noMatch: 0,
      autoAssigned: 1,
    });
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        sampleId: "S1",
        autoAssigned: false,
      })
    );
    expect(result.results[1]).toEqual(
      expect.objectContaining({
        sampleId: "S2",
        autoAssigned: true,
        suggestion: expect.objectContaining({
          status: "exact",
          alternatives: [
            {
              identifier: "alt-1",
              read1: {
                relativePath: "alt/S2_R1.fastq.gz",
                filename: "S2_R1.fastq.gz",
              },
              read2: null,
            },
          ],
        }),
      })
    );
  });

  it("matches barcode folders from sample custom fields before sample-name fallback", async () => {
    const read1 = {
      relativePath: "run-1/barcode01/SAMPLE_A_R1.fastq.gz",
      filename: "SAMPLE_A_R1.fastq.gz",
    };
    const read2 = {
      relativePath: "run-1/barcode01/SAMPLE_A_R2.fastq.gz",
      filename: "SAMPLE_A_R2.fastq.gz",
    };
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [
          {
            id: "sample-1",
            sampleId: "SAMPLE_A",
            sampleAlias: null,
            sampleTitle: null,
            customFields: JSON.stringify({ _barcode: "BC1" }),
            sequencingRunSamples: [],
            facilityStatus: "WAITING",
            reads: [],
          },
        ],
      })
    );
    mocks.files.scanDirectoryWithReport.mockResolvedValue({
      files: [read1, read2],
      warnings: {
        inaccessibleDirectories: [],
        ignoredEntries: 0,
        truncated: false,
        activeWritesSkipped: 0,
        skippedRecentFiles: [],
        maxFiles: 10000,
        maxDepth: 4,
      },
    });
    mocks.files.matchPairedEndFiles.mockReturnValue([
      {
        identifier: "SAMPLE_A",
        read1,
        read2,
        isPaired: true,
      },
    ]);

    const result = await discoverOrderSequencingFiles("order-1");

    expect(mocks.files.findFilesForSample).not.toHaveBeenCalled();
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        plannedBarcode: "barcode01",
        plannedBarcodeSource: "sample-barcode",
        suggestion: expect.objectContaining({
          status: "exact",
          matchedBy: "sample-barcode",
          read1: expect.objectContaining({ relativePath: read1.relativePath }),
          read2: expect.objectContaining({ relativePath: read2.relativePath }),
        }),
      })
    );
  });

  it("prefers run-plan barcodes over order sample barcodes", async () => {
    const runPlanRead = {
      relativePath: "run-2/barcode02/SAMPLE_A.fastq.gz",
      filename: "SAMPLE_A.fastq.gz",
    };
    const sampleBarcodeRead = {
      relativePath: "run-2/barcode01/SAMPLE_A.fastq.gz",
      filename: "SAMPLE_A.fastq.gz",
    };
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [
          {
            id: "sample-1",
            sampleId: "SAMPLE_A",
            sampleAlias: null,
            sampleTitle: null,
            customFields: JSON.stringify({ _barcode: "barcode01" }),
            sequencingRunSamples: [
              {
                barcode: "barcode02",
                sequencingRun: {
                  id: "run-db-2",
                  runId: "RUN-2",
                  runName: "Run 2",
                },
              },
            ],
            facilityStatus: "WAITING",
            reads: [],
          },
        ],
      })
    );
    mocks.files.scanDirectoryWithReport.mockResolvedValue({
      files: [sampleBarcodeRead, runPlanRead],
      warnings: {
        inaccessibleDirectories: [],
        ignoredEntries: 0,
        truncated: false,
        activeWritesSkipped: 0,
        skippedRecentFiles: [],
        maxFiles: 10000,
        maxDepth: 4,
      },
    });
    mocks.files.matchPairedEndFiles.mockReturnValue([
      {
        identifier: "SAMPLE_A",
        read1: runPlanRead,
        read2: null,
        isPaired: false,
      },
    ]);

    const result = await discoverOrderSequencingFiles("order-1");

    expect(mocks.files.matchPairedEndFiles).toHaveBeenCalledWith([runPlanRead]);
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        plannedBarcode: "barcode02",
        plannedBarcodeSource: "run-plan",
        plannedBarcodeRunId: "RUN-2",
        suggestion: expect.objectContaining({
          status: "exact",
          matchedBy: "run-plan-barcode",
          read1: expect.objectContaining({ relativePath: runPlanRead.relativePath }),
        }),
      })
    );
  });

  it("scopes run-plan barcode matching to the planned run folder", async () => {
    const currentRunRead = {
      relativePath: "run-2/barcode02/SAMPLE_A.fastq.gz",
      filename: "SAMPLE_A.fastq.gz",
    };
    const olderRunRead = {
      relativePath: "run-1/barcode02/SAMPLE_A.fastq.gz",
      filename: "SAMPLE_A.fastq.gz",
    };
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [
          {
            id: "sample-1",
            sampleId: "SAMPLE_A",
            sampleAlias: null,
            sampleTitle: null,
            customFields: null,
            sequencingRunSamples: [
              {
                barcode: "barcode02",
                sequencingRun: {
                  id: "run-db-2",
                  runId: "RUN-2",
                  runName: "Run 2",
                },
              },
            ],
            facilityStatus: "WAITING",
            reads: [],
          },
        ],
      })
    );
    mocks.files.scanDirectoryWithReport.mockResolvedValue({
      files: [olderRunRead, currentRunRead],
      warnings: {
        inaccessibleDirectories: [],
        ignoredEntries: 0,
        truncated: false,
        activeWritesSkipped: 0,
        skippedRecentFiles: [],
        maxFiles: 10000,
        maxDepth: 4,
      },
    });
    mocks.files.matchPairedEndFiles.mockReturnValue([
      {
        identifier: "SAMPLE_A",
        read1: currentRunRead,
        read2: null,
        isPaired: false,
      },
    ]);

    const result = await discoverOrderSequencingFiles("order-1");

    expect(mocks.files.matchPairedEndFiles).toHaveBeenCalledWith([currentRunRead]);
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        plannedBarcode: "barcode02",
        plannedBarcodeRunId: "RUN-2",
        suggestion: expect.objectContaining({
          status: "exact",
          matchedBy: "run-plan-barcode",
          read1: expect.objectContaining({ relativePath: currentRunRead.relativePath }),
        }),
      })
    );
  });

  it("marks barcode folder matches ambiguous when multiple pairs are present", async () => {
    const firstRead = {
      relativePath: "run-1/barcode03/part-a.fastq.gz",
      filename: "part-a.fastq.gz",
    };
    const secondRead = {
      relativePath: "run-1/barcode03/part-b.fastq.gz",
      filename: "part-b.fastq.gz",
    };
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [
          {
            id: "sample-1",
            sampleId: "SAMPLE_A",
            sampleAlias: null,
            sampleTitle: null,
            customFields: JSON.stringify({ _barcode: "barcode03" }),
            sequencingRunSamples: [],
            facilityStatus: "WAITING",
            reads: [],
          },
        ],
      })
    );
    mocks.files.scanDirectoryWithReport.mockResolvedValue({
      files: [firstRead, secondRead],
      warnings: {
        inaccessibleDirectories: [],
        ignoredEntries: 0,
        truncated: false,
        activeWritesSkipped: 0,
        skippedRecentFiles: [],
        maxFiles: 10000,
        maxDepth: 4,
      },
    });
    mocks.files.matchPairedEndFiles.mockReturnValue([
      {
        identifier: "part-a",
        read1: firstRead,
        read2: null,
        isPaired: false,
      },
      {
        identifier: "part-b",
        read1: secondRead,
        read2: null,
        isPaired: false,
      },
    ]);

    const result = await discoverOrderSequencingFiles("order-1");

    expect(result.summary.ambiguous).toBe(1);
    expect(result.results[0].suggestion).toEqual(
      expect.objectContaining({
        status: "ambiguous",
        matchedBy: "sample-barcode",
        alternatives: expect.arrayContaining([
          expect.objectContaining({ identifier: "part-a" }),
          expect.objectContaining({ identifier: "part-b" }),
        ]),
      })
    );
  });
});

describe("linkOrderSequencingArtifact", () => {
  it("creates a linked sequencing artifact for the selected sample", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [{ id: "sample-1", sampleId: "S1" }],
      })
    );

    await linkOrderSequencingArtifact("order-1", {
      sampleId: "sample-1",
      stage: "qc",
      artifactType: "qc_report",
      path: "/data/sequencing/qc/report.html",
    });

    expect(mocks.storage.statSequencingRelativePath).toHaveBeenCalledWith(
      "/data/sequencing",
      "qc/report.html"
    );
    expect(mocks.db.sequencingArtifact.create).toHaveBeenCalledWith({
      data: {
        orderId: "order-1",
        sampleId: "sample-1",
        sequencingRunId: null,
        stage: "qc",
        artifactType: "qc_report",
        source: "linked",
        visibility: "facility",
        path: "qc/report.html",
        originalName: "report.html",
        size: BigInt(123),
        checksum: null,
        mimeType: null,
        metadata: null,
        createdById: null,
      },
    });
  });
});

describe("createSequencingUploadSession", () => {
  it("creates a read upload session and stores the generated temp path", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [{ id: "sample-1", sampleId: "S1" }],
      })
    );

    const result = await createSequencingUploadSession("order-1", "user-1", {
      sampleId: "sample-1",
      targetKind: "read",
      targetRole: "R1",
      originalName: "reads.fastq.gz",
      expectedSize: 42,
      checksumProvided: "abc123",
      metadata: { stage: "qc" },
    });

    expect(mocks.db.sequencingUpload.create).toHaveBeenCalledWith({
      data: {
        orderId: "order-1",
        sampleId: "sample-1",
        targetKind: "read",
        targetRole: "R1",
        originalName: "reads.fastq.gz",
        tempPath: "",
        expectedSize: BigInt(42),
        receivedSize: BigInt(0),
        status: "PENDING",
        checksumProvided: "abc123",
        mimeType: null,
        metadata: '{"stage":"qc"}',
        createdById: "user-1",
      },
      select: {
        id: true,
        originalName: true,
      },
    });
    expect(mocks.db.sequencingUpload.update).toHaveBeenCalledWith({
      where: { id: "upload-1" },
      data: {
        tempPath: "_uploads/orders/order-1/_tmp/upload-1-reads.fastq.gz.part",
      },
    });
    expect(result).toEqual({
      uploadId: "upload-1",
      tempPath: "_uploads/orders/order-1/_tmp/upload-1-reads.fastq.gz.part",
      status: "PENDING",
      receivedSize: 0,
    });
  });

  it("rejects invalid upload kinds before touching the database", async () => {
    mocks.db.order.findUnique.mockResolvedValue(createOrder());

    await expect(
      createSequencingUploadSession("order-1", "user-1", {
        targetKind: "bogus",
        targetRole: "R1",
        originalName: "reads.fastq.gz",
        expectedSize: 42,
      })
    ).rejects.toThrow("Invalid upload target kind");

    expect(mocks.db.sequencingUpload.create).not.toHaveBeenCalled();
  });
});

describe("cancelSequencingUpload", () => {
  it("removes temp files for incomplete uploads before marking them cancelled", async () => {
    mocks.db.sequencingUpload.findUnique.mockResolvedValue({
      id: "upload-1",
      orderId: "order-1",
      tempPath: "_uploads/orders/order-1/_tmp/upload-1.part",
      finalPath: null,
      status: "UPLOADING",
    });

    await cancelSequencingUpload("order-1", "upload-1");

    expect(mocks.storage.removeSequencingRelativePath).toHaveBeenCalledWith(
      "/data/sequencing",
      "_uploads/orders/order-1/_tmp/upload-1.part"
    );
    expect(mocks.db.sequencingUpload.update).toHaveBeenCalledWith({
      where: { id: "upload-1" },
      data: { status: "CANCELLED" },
    });
  });

  it("does not remove files for completed uploads", async () => {
    mocks.db.sequencingUpload.findUnique.mockResolvedValue({
      id: "upload-1",
      orderId: "order-1",
      tempPath: "_uploads/orders/order-1/_tmp/upload-1.part",
      finalPath: "_uploads/orders/order-1/final.fastq.gz",
      status: "COMPLETED",
    });

    await cancelSequencingUpload("order-1", "upload-1");

    expect(mocks.storage.removeSequencingRelativePath).not.toHaveBeenCalled();
    expect(mocks.db.sequencingUpload.update).toHaveBeenCalledWith({
      where: { id: "upload-1" },
      data: { status: "CANCELLED" },
    });
  });
});

describe("getOrderSequencingSummary", () => {
  it("throws when order is not found", async () => {
    mocks.db.order.findUnique.mockResolvedValue(null);
    await expect(getOrderSequencingSummary("missing")).rejects.toThrow("Order not found");
  });

  it("handles samples with no reads gracefully", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            sampleAlias: null,
            sampleTitle: null,
            facilityStatus: "WAITING",
            facilityStatusUpdatedAt: null,
            updatedAt: new Date("2026-03-24T09:00:00.000Z"),
            reads: [],
            sequencingArtifacts: [],
          },
        ],
      })
    );

    const result = await getOrderSequencingSummary("order-1");

    expect(result.summary.totalSamples).toBe(1);
    expect(result.summary.readsLinkedSamples).toBe(0);
    expect(result.samples[0].read).toBeNull();
    expect(result.samples[0].hasReads).toBe(false);
  });
});

describe("assignOrderSequencingReads additional branches", () => {
  it("throws when order status is not manageable (e.g. PENDING)", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        status: "PENDING",
        samples: [],
      })
    );

    await expect(
      assignOrderSequencingReads("order-1", [])
    ).rejects.toThrow("Sequencing data can only be managed on submitted or completed orders");
  });

  it("returns error when read2 file is not found on disk", async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      status: "COMPLETED",
      samples: [
        {
          id: "sample-1",
          sampleId: "S1",
          facilityStatus: "READY",
          reads: [],
        },
      ],
    });
    mocks.files.checkFileExists
      .mockResolvedValueOnce(true)   // read1 exists
      .mockResolvedValueOnce(false); // read2 missing

    const result = await assignOrderSequencingReads("order-1", [
      {
        sampleId: "sample-1",
        read1: "manual/S1_R1.fastq.gz",
        read2: "manual/S1_R2.fastq.gz",
      },
    ]);

    expect(result).toEqual([
      { sampleId: "S1", success: false, error: "Read 2 file not found" },
    ]);
  });

  it("returns error when file path normalization throws", async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      status: "COMPLETED",
      samples: [
        {
          id: "sample-1",
          sampleId: "S1",
          facilityStatus: "READY",
          reads: [],
        },
      ],
    });
    mocks.files.hasAllowedExtension.mockReturnValue(false);

    const result = await assignOrderSequencingReads("order-1", [
      {
        sampleId: "sample-1",
        read1: "manual/S1_R1.txt",
        read2: null,
      },
    ]);

    expect(result).toEqual([
      { sampleId: "S1", success: false, error: "File extension not allowed" },
    ]);
  });
});

describe("setOrderSequencingStatuses additional branches", () => {
  it("throws when order is not found", async () => {
    mocks.db.order.findUnique.mockResolvedValue(null);
    await expect(
      setOrderSequencingStatuses("missing", [])
    ).rejects.toThrow("Order not found");
  });

  it("throws when order status is not manageable", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({ status: "PENDING" })
    );
    await expect(
      setOrderSequencingStatuses("order-1", [
        { sampleId: "s1", facilityStatus: "READY" },
      ])
    ).rejects.toThrow("Sequencing data can only be managed on submitted or completed orders");
  });
});

describe("discoverOrderSequencingFiles additional branches", () => {
  it("throws when order is not found", async () => {
    mocks.db.order.findUnique.mockResolvedValue(null);
    await expect(
      discoverOrderSequencingFiles("missing")
    ).rejects.toThrow("Order not found");
  });

  it("throws when order status is not manageable", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({ status: "PENDING" })
    );
    await expect(
      discoverOrderSequencingFiles("order-1")
    ).rejects.toThrow("Sequencing data can only be managed on submitted or completed orders");
  });

  it("reports no-match for samples with no matching files", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            sampleAlias: null,
            sampleTitle: null,
            facilityStatus: "WAITING",
            reads: [],
          },
        ],
      })
    );
    mocks.files.scanDirectoryWithReport.mockResolvedValue({
      files: [],
      warnings: {
        inaccessibleDirectories: [],
        ignoredEntries: 0,
        truncated: false,
        activeWritesSkipped: 0,
        skippedRecentFiles: [],
        maxFiles: 10000,
        maxDepth: 4,
      },
    });
    mocks.files.findFilesForSample.mockReturnValue({
      status: "none",
      read1: null,
      read2: null,
      confidence: 0,
      alternatives: [],
      matchedBy: null,
    });

    const result = await discoverOrderSequencingFiles("order-1");

    expect(result.summary.noMatch).toBe(1);
    expect(result.summary.autoAssigned).toBe(0);
    expect(result.results[0].autoAssigned).toBe(false);
  });

  it("force-scans overrides existing assignments", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            sampleAlias: null,
            sampleTitle: null,
            facilityStatus: "READY",
            reads: [{ id: "read-1", file1: "reads/existing.fastq.gz", file2: null }],
          },
        ],
      })
    );
    mocks.files.scanDirectoryWithReport.mockResolvedValue({
      files: [
        { relativePath: "reads/S1_R1.fastq.gz", filename: "S1_R1.fastq.gz" },
      ],
      warnings: {
        inaccessibleDirectories: [],
        ignoredEntries: 0,
        truncated: false,
        activeWritesSkipped: 0,
        skippedRecentFiles: [],
        maxFiles: 10000,
        maxDepth: 4,
      },
    });
    mocks.files.findFilesForSample.mockReturnValue({
      status: "partial",
      read1: { relativePath: "reads/S1_R1.fastq.gz", filename: "S1_R1.fastq.gz" },
      read2: null,
      confidence: 0.8,
      alternatives: [],
      matchedBy: "sampleId",
    });

    const result = await discoverOrderSequencingFiles("order-1", { force: true });

    expect(mocks.files.findFilesForSample).toHaveBeenCalledTimes(1);
    expect(result.summary.partialMatches).toBe(1);
  });
});

describe("linkOrderSequencingArtifact additional branches", () => {
  it("throws when order is not found", async () => {
    mocks.db.order.findUnique.mockResolvedValue(null);
    await expect(
      linkOrderSequencingArtifact("missing", {
        stage: "qc",
        artifactType: "qc_report",
        path: "/data/sequencing/report.html",
      })
    ).rejects.toThrow("Order not found");
  });

  it("links an order-level artifact when sampleId is null", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({ samples: [] })
    );

    await linkOrderSequencingArtifact("order-1", {
      sampleId: null,
      stage: "delivery",
      artifactType: "delivery_report",
      path: "/data/sequencing/delivery/report.html",
    });

    expect(mocks.db.sequencingArtifact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sampleId: null,
        stage: "delivery",
        artifactType: "delivery_report",
      }),
    });
  });
});

describe("createSequencingUploadSession additional branches", () => {
  it("rejects read uploads with invalid target role", async () => {
    mocks.db.order.findUnique.mockResolvedValue(createOrder());

    await expect(
      createSequencingUploadSession("order-1", "user-1", {
        targetKind: "read",
        targetRole: "R3",
        originalName: "reads.fastq.gz",
        expectedSize: 42,
      })
    ).rejects.toThrow("Read uploads must target R1 or R2");
  });

  it("rejects read uploads with disallowed file extensions", async () => {
    mocks.db.order.findUnique.mockResolvedValue(createOrder());
    mocks.files.hasAllowedExtension.mockReturnValue(false);

    await expect(
      createSequencingUploadSession("order-1", "user-1", {
        targetKind: "read",
        targetRole: "R1",
        originalName: "reads.txt",
        expectedSize: 42,
      })
    ).rejects.toThrow("Read uploads must use an allowed sequencing file extension");
  });

  it("creates an artifact upload session", async () => {
    mocks.db.order.findUnique.mockResolvedValue(createOrder());

    const result = await createSequencingUploadSession("order-1", "user-1", {
      targetKind: "artifact",
      targetRole: "delivery",
      originalName: "report.html",
      expectedSize: 1024,
    });

    expect(result.uploadId).toBe("upload-1");
    expect(mocks.db.sequencingUpload.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetKind: "artifact",
      }),
      select: { id: true, originalName: true },
    });
  });
});

describe("cancelSequencingUpload additional branches", () => {
  it("throws when upload is not found", async () => {
    mocks.db.sequencingUpload.findUnique.mockResolvedValue(null);
    await expect(cancelSequencingUpload("order-1", "missing")).rejects.toThrow("Upload not found");
  });

  it("throws when upload orderId does not match", async () => {
    mocks.db.sequencingUpload.findUnique.mockResolvedValue({
      id: "upload-1",
      orderId: "other-order",
      tempPath: "tmp/file.part",
      finalPath: null,
      status: "UPLOADING",
    });
    await expect(cancelSequencingUpload("order-1", "upload-1")).rejects.toThrow("Upload not found");
  });
});

describe("computeOrderSequencingChecksums", () => {
  it("updates missing read and artifact checksums and reports skipped or failed files", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            reads: [
              {
                id: "read-1",
                file1: "reads/S1_R1.fastq.gz",
                file2: null,
                checksum1: null,
                checksum2: null,
              },
              {
                id: "read-2",
                file1: "reads/S2_R1.fastq.gz",
                file2: null,
                checksum1: null,
                checksum2: null,
              },
            ],
            sequencingArtifacts: [
              {
                id: "artifact-1",
                path: "artifacts/qc.html",
                checksum: null,
              },
            ],
          },
        ],
        sequencingArtifacts: [
          {
            id: "artifact-2",
            path: "artifacts/order-report.html",
            checksum: null,
          },
        ],
      })
    );
    mocks.storage.calculateMd5ForRelativePath.mockImplementation(async (_base: string, rel: string) => {
      if (rel === "reads/S1_R1.fastq.gz") return "md5-read-1";
      if (rel === "reads/S2_R1.fastq.gz") throw new Error("ENOENT: missing");
      if (rel === "artifacts/order-report.html") return "md5-artifact";
      throw new Error("checksum failed");
    });

    const result = await computeOrderSequencingChecksums("order-1");

    expect(result).toEqual({
      updatedReads: 1,
      updatedArtifacts: 1,
      failed: 1,
      skippedMissingFiles: 1,
    });
    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-1" },
      data: { checksum1: "md5-read-1" },
    });
    expect(mocks.db.sequencingArtifact.update).toHaveBeenCalledWith({
      where: { id: "artifact-2" },
      data: { checksum: "md5-artifact" },
    });
  });

  it("throws when order is not found", async () => {
    mocks.db.order.findUnique.mockResolvedValue(null);
    await expect(computeOrderSequencingChecksums("missing")).rejects.toThrow("Order not found");
  });

  it("skips reads and artifacts that already have checksums", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            reads: [
              {
                id: "read-1",
                file1: "reads/S1_R1.fastq.gz",
                file2: null,
                checksum1: "already-has-md5",
                checksum2: null,
              },
            ],
            sequencingArtifacts: [
              {
                id: "artifact-1",
                path: "artifacts/qc.html",
                checksum: "existing-checksum",
              },
            ],
          },
        ],
        sequencingArtifacts: [],
      })
    );

    const result = await computeOrderSequencingChecksums("order-1");

    expect(result.updatedReads).toBe(0);
    expect(result.updatedArtifacts).toBe(0);
    expect(mocks.storage.calculateMd5ForRelativePath).not.toHaveBeenCalled();
  });

  it("filters reads by readIds when provided", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            reads: [
              { id: "read-1", file1: "reads/S1_R1.fastq.gz", file2: null, checksum1: null, checksum2: null },
              { id: "read-2", file1: "reads/S2_R1.fastq.gz", file2: null, checksum1: null, checksum2: null },
            ],
            sequencingArtifacts: [],
          },
        ],
        sequencingArtifacts: [],
      })
    );

    const result = await computeOrderSequencingChecksums("order-1", { readIds: ["read-1"] });

    expect(result.updatedReads).toBe(1);
    expect(mocks.storage.calculateMd5ForRelativePath).toHaveBeenCalledTimes(1);
  });
});

describe("appendSequencingUploadChunk", () => {
  it("writes chunk data and updates upload progress", async () => {
    mocks.db.sequencingUpload.findUnique.mockResolvedValue({
      id: "upload-1",
      orderId: "order-1",
      tempPath: "_uploads/orders/order-1/_tmp/upload-1.part",
      receivedSize: BigInt(0),
      expectedSize: BigInt(1000),
      status: "PENDING",
    });
    mocks.storage.statSequencingRelativePath.mockResolvedValue({
      size: BigInt(500),
      modifiedAt: new Date(),
    });

    const mockStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });

    const result = await appendSequencingUploadChunk("order-1", "upload-1", BigInt(0), mockStream);

    expect(mocks.storage.writeSequencingUploadChunk).toHaveBeenCalledWith(
      "/data/sequencing",
      "_uploads/orders/order-1/_tmp/upload-1.part",
      mockStream,
      true
    );
    expect(result.receivedSize).toBe(500);
    expect(result.status).toBe("UPLOADING");
  });

  it("marks upload as READY when received size meets expected size", async () => {
    mocks.db.sequencingUpload.findUnique.mockResolvedValue({
      id: "upload-1",
      orderId: "order-1",
      tempPath: "_uploads/orders/order-1/_tmp/upload-1.part",
      receivedSize: BigInt(500),
      expectedSize: BigInt(1000),
      status: "UPLOADING",
    });
    mocks.storage.statSequencingRelativePath.mockResolvedValue({
      size: BigInt(1000),
      modifiedAt: new Date(),
    });

    const mockStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    });

    const result = await appendSequencingUploadChunk("order-1", "upload-1", BigInt(500), mockStream);

    expect(result.status).toBe("READY");
    expect(result.receivedSize).toBe(1000);
  });

  it("throws when upload is not found", async () => {
    mocks.db.sequencingUpload.findUnique.mockResolvedValue(null);

    const mockStream = new ReadableStream<Uint8Array>();
    await expect(
      appendSequencingUploadChunk("order-1", "missing", BigInt(0), mockStream)
    ).rejects.toThrow("Upload not found");
  });

  it("throws when upload orderId does not match", async () => {
    mocks.db.sequencingUpload.findUnique.mockResolvedValue({
      id: "upload-1",
      orderId: "other-order",
      tempPath: "tmp/file.part",
      receivedSize: BigInt(0),
      expectedSize: BigInt(100),
      status: "PENDING",
    });

    const mockStream = new ReadableStream<Uint8Array>();
    await expect(
      appendSequencingUploadChunk("order-1", "upload-1", BigInt(0), mockStream)
    ).rejects.toThrow("Upload not found");
  });

  it("throws when offset does not match received size", async () => {
    mocks.db.sequencingUpload.findUnique.mockResolvedValue({
      id: "upload-1",
      orderId: "order-1",
      tempPath: "tmp/file.part",
      receivedSize: BigInt(100),
      expectedSize: BigInt(1000),
      status: "UPLOADING",
    });

    const mockStream = new ReadableStream<Uint8Array>();
    await expect(
      appendSequencingUploadChunk("order-1", "upload-1", BigInt(200), mockStream)
    ).rejects.toThrow("Upload offset does not match");
  });
});

describe("completeSequencingUpload", () => {
  it("throws when upload is not found", async () => {
    mocks.db.sequencingUpload.findUnique.mockResolvedValue(null);
    await expect(completeSequencingUpload("order-1", "missing")).rejects.toThrow("Upload not found");
  });

  it("throws when upload is incomplete", async () => {
    mocks.db.sequencingUpload.findUnique.mockResolvedValue({
      id: "upload-1",
      orderId: "order-1",
      sampleId: null,
      targetKind: "read",
      targetRole: "R1",
      originalName: "reads.fastq.gz",
      tempPath: "tmp/file.part",
      expectedSize: BigInt(1000),
      receivedSize: BigInt(500),
      checksumProvided: null,
      checksumComputed: null,
      mimeType: null,
      metadata: null,
      finalPath: null,
      createdById: "user-1",
    });
    await expect(completeSequencingUpload("order-1", "upload-1")).rejects.toThrow("Upload is incomplete");
  });

  it("completes an artifact upload and creates artifact record", async () => {
    mocks.db.sequencingUpload.findUnique.mockResolvedValue({
      id: "upload-1",
      orderId: "order-1",
      sampleId: null,
      targetKind: "artifact",
      targetRole: "delivery",
      originalName: "report.html",
      tempPath: "_uploads/tmp/upload-1.part",
      expectedSize: BigInt(200),
      receivedSize: BigInt(200),
      checksumProvided: "abc123",
      checksumComputed: null,
      mimeType: "text/html",
      metadata: JSON.stringify({ stage: "delivery", artifactType: "report" }),
      finalPath: null,
      createdById: "user-1",
    });
    mocks.db.order.findUnique.mockResolvedValue(createOrder());
    mocks.storage.statSequencingRelativePath.mockResolvedValue({
      size: BigInt(200),
      modifiedAt: new Date(),
    });

    const result = await completeSequencingUpload("order-1", "upload-1");

    expect(result.status).toBe("COMPLETED");
    expect(result.size).toBe(200);
    expect(mocks.storage.finalizeSequencingUpload).toHaveBeenCalled();
    expect(mocks.db.sequencingArtifact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: "order-1",
        stage: "delivery",
        artifactType: "report",
        source: "upload",
      }),
    });
    expect(mocks.db.sequencingUpload.update).toHaveBeenCalledWith({
      where: { id: "upload-1" },
      data: { finalPath: expect.any(String), status: "COMPLETED" },
    });
  });

  it("completes a read upload and assigns reads to sample", async () => {
    mocks.db.sequencingUpload.findUnique.mockResolvedValue({
      id: "upload-1",
      orderId: "order-1",
      sampleId: "sample-1",
      targetKind: "read",
      targetRole: "R1",
      originalName: "reads.fastq.gz",
      tempPath: "_uploads/tmp/upload-1.part",
      expectedSize: BigInt(500),
      receivedSize: BigInt(500),
      checksumProvided: "md5-provided",
      checksumComputed: null,
      mimeType: null,
      metadata: null,
      finalPath: null,
      createdById: "user-1",
    });
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            facilityStatus: "WAITING",
            reads: [],
          },
        ],
      })
    );
    mocks.storage.statSequencingRelativePath.mockResolvedValue({
      size: BigInt(500),
      modifiedAt: new Date(),
    });

    const result = await completeSequencingUpload("order-1", "upload-1");

    expect(result.status).toBe("COMPLETED");
    expect(mocks.db.read.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sampleId: "sample-1",
        checksum1: "md5-provided",
      }),
    });
  });

  it("throws when read upload has no target sample", async () => {
    mocks.db.sequencingUpload.findUnique.mockResolvedValue({
      id: "upload-1",
      orderId: "order-1",
      sampleId: null,
      targetKind: "read",
      targetRole: "R1",
      originalName: "reads.fastq.gz",
      tempPath: "_uploads/tmp/upload-1.part",
      expectedSize: BigInt(100),
      receivedSize: BigInt(100),
      checksumProvided: null,
      checksumComputed: null,
      mimeType: null,
      metadata: null,
      finalPath: null,
      createdById: "user-1",
    });
    mocks.db.order.findUnique.mockResolvedValue(createOrder());
    mocks.storage.statSequencingRelativePath.mockResolvedValue({
      size: BigInt(100),
      modifiedAt: new Date(),
    });

    await expect(completeSequencingUpload("order-1", "upload-1")).rejects.toThrow(
      "Read uploads require a target sample"
    );
  });
});

describe("classifyOrderSequencingRead", () => {
  it("classifies the active read when no readId is given", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            facilityStatus: "SEQUENCED",
            reads: [{ id: "read-1", file1: "reads/S1_R1.fastq.gz", file2: null, isActive: true }],
          },
        ],
      })
    );
    mocks.db.read.update.mockResolvedValue({
      id: "read-1",
      dataClass: "raw",
      dataClassSource: "manual",
    });

    const result = await classifyOrderSequencingRead(
      "order-1",
      { sampleId: "sample-1", dataClass: "raw", classificationNote: "looks raw" },
      "user-7"
    );

    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-1" },
      data: expect.objectContaining({
        dataClass: "raw",
        dataClassSource: "manual",
        classifiedById: "user-7",
        classificationNote: "looks raw",
      }),
    });
    expect(result).toMatchObject({
      id: "read-1",
      dataClass: "raw",
      isProtectedRaw: true,
    });
  });

  it("classifies a specific read by readId", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            facilityStatus: "SEQUENCED",
            reads: [
              { id: "read-1", file1: "reads/a.fastq.gz", file2: null, isActive: true },
              { id: "read-2", file1: "reads/b.fastq.gz", file2: null, isActive: false },
            ],
          },
        ],
      })
    );
    mocks.db.read.update.mockResolvedValue({ id: "read-2", dataClass: "cleaned", dataClassSource: "manual" });

    await classifyOrderSequencingRead("order-1", {
      sampleId: "sample-1",
      readId: "read-2",
      dataClass: "cleaned",
    });

    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-2" },
      data: expect.objectContaining({ dataClass: "cleaned" }),
    });
  });

  it("throws when the order is not found", async () => {
    mocks.db.order.findUnique.mockResolvedValue(null);
    await expect(
      classifyOrderSequencingRead("missing", { sampleId: "s1", dataClass: "raw" })
    ).rejects.toThrow("Order not found");
  });

  it("throws when the sample is not found", async () => {
    mocks.db.order.findUnique.mockResolvedValue(createOrder({ samples: [] }));
    await expect(
      classifyOrderSequencingRead("order-1", { sampleId: "missing", dataClass: "raw" })
    ).rejects.toThrow("Sample not found");
  });

  it("throws when there is no read record to classify", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [{ id: "sample-1", sampleId: "S1", facilityStatus: "WAITING", reads: [] }],
      })
    );
    await expect(
      classifyOrderSequencingRead("order-1", { sampleId: "sample-1", dataClass: "raw" })
    ).rejects.toThrow("Read record not found");
  });
});

describe("assignOrderSequencingReads protected-source preservation", () => {
  it("supersedes a protected raw read with a new cleaned read via a transaction", async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      status: "COMPLETED",
      samples: [
        {
          id: "sample-1",
          sampleId: "S1",
          facilityStatus: "SEQUENCED",
          reads: [
            {
              id: "raw-read",
              file1: "raw/S1_R1.fastq.gz",
              file2: "raw/S1_R2.fastq.gz",
              dataClass: "raw",
              isActive: true,
            },
          ],
        },
      ],
    });
    // The transaction callback receives a tx client mirroring db.read.
    const tx = {
      read: {
        create: vi.fn().mockResolvedValue({ id: "new-read" }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    mocks.db.$transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<void>) => cb(tx));

    await assignOrderSequencingReads("order-1", [
      {
        sampleId: "sample-1",
        read1: "cleaned/S1_R1.fastq.gz",
        read2: "cleaned/S1_R2.fastq.gz",
        dataClass: "cleaned",
      },
    ]);

    expect(mocks.db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.read.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sampleId: "sample-1",
        file1: "cleaned/S1_R1.fastq.gz",
        file2: "cleaned/S1_R2.fastq.gz",
        isActive: false,
        dataClass: "cleaned",
      }),
    });
    // Old raw read is superseded; new read activated.
    expect(tx.read.update).toHaveBeenCalledWith({
      where: { id: "raw-read" },
      data: { isActive: false, supersededByReadId: "new-read" },
    });
    expect(tx.read.update).toHaveBeenCalledWith({
      where: { id: "new-read" },
      data: { isActive: true },
    });
    // No direct (non-tx) read.update should be issued in this path.
    expect(mocks.db.read.update).not.toHaveBeenCalled();
  });

  it("resolves absolute read paths against the data base path", async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      status: "COMPLETED",
      samples: [{ id: "sample-1", sampleId: "S1", facilityStatus: "WAITING", reads: [] }],
    });
    // Absolute path is converted to a relative path under the base.
    mocks.files.toRelativePath.mockReturnValue("reads/abs_R1.fastq.gz");

    const result = await assignOrderSequencingReads("order-1", [
      {
        sampleId: "sample-1",
        read1: "/data/sequencing/reads/abs_R1.fastq.gz",
        read2: null,
      },
    ]);

    expect(result).toEqual([{ sampleId: "S1", success: true }]);
    expect(mocks.files.toRelativePath).toHaveBeenCalledWith(
      "/data/sequencing",
      "/data/sequencing/reads/abs_R1.fastq.gz"
    );
    expect(mocks.db.read.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ file1: "reads/abs_R1.fastq.gz" }),
    });
  });

  it("returns an invalid-file-path error when normalization yields the base root", async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      status: "COMPLETED",
      samples: [{ id: "sample-1", sampleId: "S1", facilityStatus: "WAITING", reads: [] }],
    });
    // Absolute path that resolves to "." (the base itself) is rejected.
    mocks.files.toRelativePath.mockReturnValue(".");

    const result = await assignOrderSequencingReads("order-1", [
      {
        sampleId: "sample-1",
        read1: "/data/sequencing",
        read2: null,
      },
    ]);

    expect(result).toEqual([
      { sampleId: "S1", success: false, error: "Invalid file path" },
    ]);
    expect(mocks.db.read.create).not.toHaveBeenCalled();
  });
});

describe("getOrderSequencingSummary stream + read-origin branches", () => {
  it("aggregates stream-ingested file stats and active-run info per sample", async () => {
    const baseTime = new Date("2026-03-24T09:00:00.000Z");
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            sampleAlias: null,
            sampleTitle: null,
            customFields: null,
            sequencingRunSamples: [],
            facilityStatus: "PROCESSING",
            facilityStatusUpdatedAt: null,
            updatedAt: baseTime,
            reads: [],
            sequencingArtifacts: [],
          },
        ],
      })
    );
    mocks.db.streamIngestedFile.groupBy.mockResolvedValue([
      {
        sampleId: "sample-1",
        _count: { _all: 3 },
        _sum: { reads: 1500, bases: BigInt(450000) },
        _max: { ingestedAt: new Date("2026-03-24T10:00:00.000Z") },
      },
      // A row without a sampleId is ignored.
      {
        sampleId: null,
        _count: { _all: 9 },
        _sum: { reads: 0, bases: BigInt(0) },
        _max: { ingestedAt: null },
      },
    ]);
    mocks.db.streamIngestedFile.findMany.mockResolvedValue([
      { sampleId: "sample-1", streamRunId: "stream-run-1" },
    ]);

    const result = await getOrderSequencingSummary("order-1");

    expect(result.samples[0].stream).toEqual({
      fileCount: 3,
      totalReads: 1500,
      totalBases: 450000,
      lastFileAt: "2026-03-24T10:00:00.000Z",
      activeRunId: "stream-run-1",
    });
    expect(result.summary.statusCounts.PROCESSING).toBe(1);
  });

  it("derives pipeline and legacy read origins", async () => {
    const baseTime = new Date("2026-03-24T09:00:00.000Z");
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            sampleAlias: null,
            sampleTitle: null,
            customFields: null,
            sequencingRunSamples: [],
            facilityStatus: "READY",
            facilityStatusUpdatedAt: null,
            updatedAt: baseTime,
            reads: [
              {
                id: "read-1",
                file1: "reads/S1_R1.fastq.gz",
                file2: null,
                checksum1: "c1",
                checksum2: null,
                readCount1: null,
                readCount2: null,
                avgQuality1: null,
                avgQuality2: null,
                fastqcReport1: null,
                fastqcReport2: null,
                pipelineRunId: "run-9",
                // Pipeline sources without simulate-reads => "pipeline" origin.
                pipelineSources: '{"trimming":"run-9"}',
                dataClassSource: "associate",
                pipelineRun: { runNumber: 9 },
                sequencingRun: null,
                isActive: true,
              },
            ],
            sequencingArtifacts: [],
          },
        ],
      })
    );
    mocks.fs.stat.mockResolvedValue({ size: 50, mtime: baseTime });

    const result = await getOrderSequencingSummary("order-1");

    expect(result.samples[0].read).toEqual(
      expect.objectContaining({
        readOrigin: "pipeline",
        isSimulated: false,
      })
    );
  });

  it("counts protected provenance reads kept around inactively", async () => {
    const baseTime = new Date("2026-03-24T09:00:00.000Z");
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            sampleAlias: null,
            sampleTitle: null,
            customFields: null,
            sequencingRunSamples: [],
            facilityStatus: "READY",
            facilityStatusUpdatedAt: null,
            updatedAt: baseTime,
            reads: [
              {
                id: "active-clean",
                file1: "reads/clean_R1.fastq.gz",
                file2: null,
                checksum1: "c1",
                checksum2: null,
                readCount1: null,
                readCount2: null,
                avgQuality1: null,
                avgQuality2: null,
                fastqcReport1: null,
                fastqcReport2: null,
                pipelineRunId: null,
                pipelineSources: null,
                dataClass: "cleaned",
                dataClassSource: "associate",
                pipelineRun: null,
                sequencingRun: null,
                isActive: true,
              },
              {
                id: "raw-provenance",
                file1: "reads/raw_R1.fastq.gz",
                file2: null,
                checksum1: "c2",
                checksum2: null,
                readCount1: null,
                readCount2: null,
                avgQuality1: null,
                avgQuality2: null,
                fastqcReport1: null,
                fastqcReport2: null,
                pipelineRunId: null,
                pipelineSources: null,
                dataClass: "raw",
                dataClassSource: "manual",
                pipelineRun: null,
                sequencingRun: null,
                isActive: false,
              },
            ],
            sequencingArtifacts: [],
          },
        ],
      })
    );
    mocks.fs.stat.mockResolvedValue({ size: 50, mtime: baseTime });

    const result = await getOrderSequencingSummary("order-1");

    expect(result.samples[0].protectedProvenanceCount).toBe(1);
    expect(result.samples[0].protectedProvenance[0]).toEqual(
      expect.objectContaining({ id: "raw-provenance", dataClass: "raw" })
    );
  });

  it("reads the sequencing tech selection from a plain string custom field", async () => {
    const baseTime = new Date("2026-03-24T09:00:00.000Z");
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        customFields: JSON.stringify({ _sequencing_tech: "illumina" }),
        samples: [],
      })
    );

    const result = await getOrderSequencingSummary("order-1");
    void baseTime;

    expect(result.sequencingTechSelection).toEqual({
      id: "illumina",
      name: "illumina",
      label: "illumina",
      platform: "illumina",
    });
  });

  it("returns null sequencing tech selection for an empty string custom field", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        customFields: JSON.stringify({ _sequencing_tech: "   " }),
        samples: [],
      })
    );

    const result = await getOrderSequencingSummary("order-1");

    expect(result.sequencingTechSelection).toBeNull();
  });
});

describe("completeSequencingUpload R2 + superseding branches", () => {
  it("merges an R2 upload onto the existing R1 read, preserving its checksum", async () => {
    mocks.db.sequencingUpload.findUnique.mockResolvedValue({
      id: "upload-1",
      orderId: "order-1",
      sampleId: "sample-1",
      targetKind: "read",
      targetRole: "R2",
      originalName: "reads_R2.fastq.gz",
      tempPath: "_uploads/tmp/upload-1.part",
      expectedSize: BigInt(500),
      receivedSize: BigInt(500),
      checksumProvided: "md5-r2",
      checksumComputed: null,
      mimeType: null,
      metadata: JSON.stringify({ dataClass: "cleaned" }),
      finalPath: null,
      createdById: "user-1",
    });
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            facilityStatus: "SEQUENCED",
            reads: [
              {
                id: "read-1",
                file1: "reads/existing_R1.fastq.gz",
                file2: null,
                checksum1: "md5-existing-r1",
                checksum2: null,
                dataClass: "cleaned",
                isActive: true,
              },
            ],
          },
        ],
      })
    );
    mocks.storage.statSequencingRelativePath.mockResolvedValue({
      size: BigInt(500),
      modifiedAt: new Date(),
    });

    const result = await completeSequencingUpload("order-1", "upload-1");

    expect(result.status).toBe("COMPLETED");
    // Existing read gets updated (not superseded): R1 kept, R2 + its checksum set.
    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-1" },
      data: expect.objectContaining({
        file1: "reads/existing_R1.fastq.gz",
        file2: expect.any(String),
        checksum1: "md5-existing-r1",
        checksum2: "md5-r2",
      }),
    });
  });
});

describe("computeOrderSequencingChecksums additional branches", () => {
  it("computes checksum2 for reads that only miss the R2 checksum", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            reads: [
              {
                id: "read-1",
                file1: "reads/S1_R1.fastq.gz",
                file2: "reads/S1_R2.fastq.gz",
                checksum1: "already",
                checksum2: null,
              },
            ],
            sequencingArtifacts: [],
          },
        ],
        sequencingArtifacts: [],
      })
    );
    mocks.storage.calculateMd5ForRelativePath.mockResolvedValue("md5-r2");

    const result = await computeOrderSequencingChecksums("order-1");

    expect(result.updatedReads).toBe(1);
    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-1" },
      data: { checksum2: "md5-r2" },
    });
  });

  it("counts a non-ENOENT artifact checksum failure as failed", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [],
        sequencingArtifacts: [
          { id: "artifact-1", path: "artifacts/broken.html", checksum: null },
        ],
      })
    );
    mocks.storage.calculateMd5ForRelativePath.mockRejectedValue(new Error("permission denied"));

    const result = await computeOrderSequencingChecksums("order-1");

    expect(result.failed).toBe(1);
    expect(result.skippedMissingFiles).toBe(0);
    expect(result.updatedArtifacts).toBe(0);
  });

  it("skips artifacts that have no path", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [],
        sequencingArtifacts: [
          { id: "artifact-1", path: null, checksum: null },
        ],
      })
    );

    const result = await computeOrderSequencingChecksums("order-1");

    expect(result.updatedArtifacts).toBe(0);
    expect(mocks.storage.calculateMd5ForRelativePath).not.toHaveBeenCalled();
  });

  it("filters artifacts by artifactIds when provided", async () => {
    mocks.db.order.findUnique.mockResolvedValue(
      createOrder({
        samples: [],
        sequencingArtifacts: [
          { id: "artifact-1", path: "artifacts/a.html", checksum: null },
          { id: "artifact-2", path: "artifacts/b.html", checksum: null },
        ],
      })
    );
    mocks.storage.calculateMd5ForRelativePath.mockResolvedValue("md5");

    const result = await computeOrderSequencingChecksums("order-1", {
      artifactIds: ["artifact-2"],
    });

    expect(result.updatedArtifacts).toBe(1);
    expect(mocks.storage.calculateMd5ForRelativePath).toHaveBeenCalledTimes(1);
    expect(mocks.storage.calculateMd5ForRelativePath).toHaveBeenCalledWith(
      "/data/sequencing",
      "artifacts/b.html"
    );
  });
});
