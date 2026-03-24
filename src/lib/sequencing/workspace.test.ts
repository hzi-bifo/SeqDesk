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
    sample: {
      update: vi.fn(),
    },
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

vi.mock("@/lib/orders/auto-complete", () => ({
  checkAndCompleteOrder: mocks.autoComplete.checkAndCompleteOrder,
}));

import { assignOrderSequencingReads } from "./workspace";

describe("assignOrderSequencingReads", () => {
  beforeEach(() => {
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
    mocks.db.sample.update.mockResolvedValue({});
    mocks.autoComplete.checkAndCompleteOrder.mockResolvedValue(undefined);
  });

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
});
