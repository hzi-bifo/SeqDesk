import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    order: {
      findUnique: vi.fn(),
    },
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
  },
  fs: {
    stat: vi.fn(),
  },
  files: {
    checkFileExists: vi.fn(),
    ensureWithinBase: vi.fn(),
    findFilesForSample: vi.fn(),
    hasAllowedExtension: vi.fn(),
    scanDirectory: vi.fn(),
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
  scanDirectory: mocks.files.scanDirectory,
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
  });
  mocks.files.hasAllowedExtension.mockReturnValue(true);
  mocks.files.scanDirectory.mockResolvedValue([]);
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
    },
  });
  mocks.db.read.update.mockResolvedValue({});
  mocks.db.read.create.mockResolvedValue({});
  mocks.db.sequencingArtifact.create.mockResolvedValue({});
  mocks.db.sequencingArtifact.update.mockResolvedValue({});
  mocks.db.sequencingUpload.create.mockResolvedValue({
    id: "upload-1",
    originalName: "reads.fastq.gz",
  });
  mocks.db.sequencingUpload.update.mockResolvedValue({});
  mocks.db.sequencingUpload.findUnique.mockResolvedValue(null);
  mocks.db.sample.update.mockResolvedValue({});
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
      data: {
        sampleId: "sample-1",
        file1: "manual/S1_R1.fastq.gz",
        file2: "manual/S1_R2.fastq.gz",
        checksum1: "abc123",
        checksum2: "def456",
        sequencingRunId: "seq-run-1",
        pipelineRunId: null,
        pipelineSources: null,
      },
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
                pipelineSources: '{"fastqc":"run-9"}',
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
        pipelineSources: { fastqc: "run-9" },
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
    mocks.files.scanDirectory.mockResolvedValue([
      { relativePath: "reads/S2_R1.fastq.gz", filename: "S2_R1.fastq.gz" },
      { relativePath: "reads/S2_R2.fastq.gz", filename: "S2_R2.fastq.gz" },
    ]);
    mocks.files.findFilesForSample.mockReturnValue({
      status: "exact",
      read1: { relativePath: "reads/S2_R1.fastq.gz", filename: "S2_R1.fastq.gz" },
      read2: { relativePath: "reads/S2_R2.fastq.gz", filename: "S2_R2.fastq.gz" },
      confidence: 0.95,
      alternatives: [
        {
          identifier: "alt-1",
          read1: { relativePath: "alt/S2_R1.fastq.gz", filename: "S2_R1.fastq.gz" },
          read2: null,
        },
      ],
    });

    const result = await discoverOrderSequencingFiles("order-1", { autoAssign: true });

    expect(mocks.files.scanDirectory).toHaveBeenCalledWith(
      "/data/sequencing",
      {
        allowedExtensions: [".fastq.gz"],
        maxDepth: 4,
        ignorePatterns: [],
      },
      false
    );
    expect(mocks.files.findFilesForSample).toHaveBeenCalledTimes(1);
    expect(mocks.db.read.create).toHaveBeenCalledWith({
      data: {
        sampleId: "sample-2",
        file1: "reads/S2_R1.fastq.gz",
        file2: "reads/S2_R2.fastq.gz",
        checksum1: null,
        checksum2: null,
        sequencingRunId: null,
        pipelineRunId: null,
        pipelineSources: null,
      },
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
    mocks.files.scanDirectory.mockResolvedValue([]);
    mocks.files.findFilesForSample.mockReturnValue({
      status: "none",
      read1: null,
      read2: null,
      confidence: 0,
      alternatives: [],
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
    mocks.files.scanDirectory.mockResolvedValue([
      { relativePath: "reads/S1_R1.fastq.gz", filename: "S1_R1.fastq.gz" },
    ]);
    mocks.files.findFilesForSample.mockReturnValue({
      status: "partial",
      read1: { relativePath: "reads/S1_R1.fastq.gz", filename: "S1_R1.fastq.gz" },
      read2: null,
      confidence: 0.8,
      alternatives: [],
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
