import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    read: {
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
  },
  dataBasePath: {
    getResolvedDataBasePath: vi.fn(),
  },
  packageLoader: {
    getPackage: vi.fn(),
  },
  adapters: {
    getAdapter: vi.fn(),
    registerAdapter: vi.fn(),
  },
  genericAdapter: {
    createGenericAdapter: vi.fn(),
  },
  fs: {
    rm: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/files/data-base-path", () => ({
  getResolvedDataBasePath: mocks.dataBasePath.getResolvedDataBasePath,
}));

vi.mock("./package-loader", () => ({
  getPackage: mocks.packageLoader.getPackage,
}));

vi.mock("./adapters/types", async () => {
  const actual = await vi.importActual("./adapters/types");
  return {
    ...actual,
    getAdapter: mocks.adapters.getAdapter,
    registerAdapter: mocks.adapters.registerAdapter,
  };
});

vi.mock("./generic-adapter", () => ({
  createGenericAdapter: mocks.genericAdapter.createGenericAdapter,
}));

vi.mock("fs/promises", () => ({
  default: {
    rm: mocks.fs.rm,
  },
}));

import { cleanupRunOutputData } from "./run-delete";

describe("run-delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fs.rm.mockResolvedValue(undefined);
    mocks.db.read.findFirst.mockResolvedValue(null);
    mocks.db.read.delete.mockResolvedValue({});
    mocks.dataBasePath.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath: "/data/sequencing",
    });
  });

  it("deletes current simulated reads when they still match the run output", async () => {
    const adapter = {
      discoverOutputs: vi.fn().mockResolvedValue({
        files: [
          {
            outputId: "sample_simulated_reads",
            sampleId: "sample-1",
            metadata: {
              file1: "simulated/order_order-1/S1_R1.fastq.gz",
              file2: "simulated/order_order-1/S1_R2.fastq.gz",
            },
          },
        ],
        errors: [],
        summary: {
          assembliesFound: 0,
          binsFound: 0,
          artifactsFound: 1,
          reportsFound: 0,
        },
      }),
    };

    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "sample_simulated_reads",
            destination: "sample_reads",
          },
        ],
      },
    });
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.db.read.findFirst.mockResolvedValue({
      id: "read-1",
      file1: "simulated/order_order-1/S1_R1.fastq.gz",
      file2: "simulated/order_order-1/S1_R2.fastq.gz",
    });

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "simulate-reads",
      runFolder: "/tmp/run-1",
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });

    expect(adapter.discoverOutputs).toHaveBeenCalledWith({
      runId: "run-1",
      outputDir: "/tmp/run-1/output",
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });
    expect(mocks.fs.rm).toHaveBeenCalledTimes(2);
    expect(mocks.fs.rm).toHaveBeenCalledWith(
      "/data/sequencing/simulated/order_order-1/S1_R1.fastq.gz",
      { force: true }
    );
    expect(mocks.fs.rm).toHaveBeenCalledWith(
      "/data/sequencing/simulated/order_order-1/S1_R2.fastq.gz",
      { force: true }
    );
    expect(mocks.db.read.delete).toHaveBeenCalledWith({
      where: { id: "read-1" },
    });
  });

  it("does not delete reads when the sample has been relinked since the run completed", async () => {
    const adapter = {
      discoverOutputs: vi.fn().mockResolvedValue({
        files: [
          {
            outputId: "sample_simulated_reads",
            sampleId: "sample-1",
            metadata: {
              file1: "simulated/order_order-1/S1_R1.fastq.gz",
              file2: "simulated/order_order-1/S1_R2.fastq.gz",
            },
          },
        ],
        errors: [],
        summary: {
          assembliesFound: 0,
          binsFound: 0,
          artifactsFound: 1,
          reportsFound: 0,
        },
      }),
    };

    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "sample_simulated_reads",
            destination: "sample_reads",
          },
        ],
      },
    });
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.db.read.findFirst.mockResolvedValue({
      id: "read-1",
      file1: "manual/S1_R1.fastq.gz",
      file2: "manual/S1_R2.fastq.gz",
    });

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "simulate-reads",
      runFolder: "/tmp/run-1",
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });

    expect(mocks.fs.rm).not.toHaveBeenCalled();
    expect(mocks.db.read.delete).not.toHaveBeenCalled();
  });
});
