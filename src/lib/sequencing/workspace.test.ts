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
  assignOrderSequencingReads,
  cancelSequencingUpload,
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
});
