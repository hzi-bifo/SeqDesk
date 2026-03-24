import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    read: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    pipelineRun: {
      count: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    pipelineRunStep: {
      deleteMany: vi.fn(),
    },
    pipelineArtifact: {
      deleteMany: vi.fn(),
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
    mocks.db.read.findMany.mockResolvedValue([]);
    mocks.db.read.delete.mockResolvedValue({});
    mocks.db.read.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.read.update.mockResolvedValue({});
    mocks.db.read.updateMany.mockResolvedValue({ count: 0 });
    mocks.db.pipelineRun.count.mockResolvedValue(0);
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);
    mocks.db.pipelineRun.delete.mockResolvedValue({});
    mocks.db.pipelineRunStep.deleteMany.mockResolvedValue({});
    mocks.db.pipelineArtifact.deleteMany.mockResolvedValue({});
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

  it("returns early when the pipeline package is unknown", async () => {
    mocks.packageLoader.getPackage.mockReturnValue(null);

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "missing-pipeline",
      runFolder: "/tmp/run-1",
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });

    expect(mocks.db.pipelineRun.findMany).not.toHaveBeenCalled();
    expect(mocks.db.read.deleteMany).not.toHaveBeenCalled();
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

  it("does not delete reads when another run is the active source", async () => {
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
      pipelineRunId: "run-2",
      pipelineSources: '{"simulate-reads":"run-2"}',
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

  it("ignores invalid pipeline source metadata and falls back to pipelineRunId", async () => {
    const adapter = {
      discoverOutputs: vi.fn().mockResolvedValue({
        files: [
          {
            outputId: "sample_checksums",
            sampleId: "sample-1",
            metadata: {
              checksum1: "abc123",
            },
          },
        ],
        errors: [],
        summary: { assembliesFound: 0, binsFound: 0, artifactsFound: 1, reportsFound: 0 },
      }),
    };

    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        inputs: [{ id: "reads", scope: "sample", source: "sample.reads", required: true }],
        outputs: [{ id: "sample_checksums", destination: "sample_reads" }],
      },
    });
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.db.read.findFirst.mockResolvedValue({
      id: "read-1",
      pipelineRunId: "run-1",
      pipelineSources: "{invalid-json",
    });

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "fastq-checksum",
      runFolder: "/tmp/run-1",
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });

    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-1" },
      data: { checksum1: null },
    });
  });

  it("cascade-deletes dependent pipeline runs when reads are deleted", async () => {
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
        summary: { assembliesFound: 0, binsFound: 0, artifactsFound: 1, reportsFound: 0 },
      }),
    };

    mocks.packageLoader.getPackage.mockImplementation((id: string) => {
      if (id === "simulate-reads") {
        return {
          manifest: {
            inputs: [],
            outputs: [{ id: "sample_simulated_reads", destination: "sample_reads" }],
          },
        };
      }
      if (id === "fastq-checksum") {
        return {
          manifest: {
            inputs: [{ id: "reads", scope: "sample", source: "sample.reads", required: true }],
            outputs: [{ id: "sample_checksums", destination: "sample_reads" }],
          },
        };
      }
      if (id === "fastqc") {
        return {
          manifest: {
            inputs: [{ id: "reads", scope: "sample", source: "sample.reads", required: true }],
            outputs: [{ id: "sample_fastqc_reads", destination: "sample_reads" }],
          },
        };
      }
      if (id === "simulate-reads-dependent") {
        return {
          manifest: {
            inputs: [],
            outputs: [{ id: "sample_simulated_reads", destination: "sample_reads" }],
          },
        };
      }
      return null;
    });
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.db.read.findFirst.mockResolvedValue({
      id: "read-1",
      file1: "simulated/order_order-1/S1_R1.fastq.gz",
      file2: "simulated/order_order-1/S1_R2.fastq.gz",
      pipelineRunId: "run-1",
      pipelineSources: '{"simulate-reads":"run-1"}',
    });
    mocks.db.pipelineRun.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "checksum-run-1",
          pipelineId: "fastq-checksum",
          runFolder: "/tmp/checksum-run-1",
          inputSampleIds: null,
        },
        {
          id: "fastqc-run-1",
          pipelineId: "fastqc",
          runFolder: "/tmp/fastqc-run-1",
          inputSampleIds: '["sample-2"]',
        },
        {
          id: "producer-run-1",
          pipelineId: "simulate-reads-dependent",
          runFolder: "/tmp/producer-run-1",
          inputSampleIds: null,
        },
      ]);

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "simulate-reads",
      runFolder: "/tmp/run-1",
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });

    // The read should be deleted
    expect(mocks.db.read.delete).toHaveBeenCalledWith({ where: { id: "read-1" } });
    // Dependent FASTQ Checksum run should be cascade-deleted
    expect(mocks.db.pipelineRunStep.deleteMany).toHaveBeenCalledWith({
      where: { pipelineRunId: "checksum-run-1" },
    });
    expect(mocks.db.pipelineArtifact.deleteMany).toHaveBeenCalledWith({
      where: { pipelineRunId: "checksum-run-1" },
    });
    expect(mocks.db.pipelineRun.delete).toHaveBeenCalledWith({
      where: { id: "checksum-run-1" },
    });
    expect(mocks.db.pipelineRun.delete).not.toHaveBeenCalledWith({
      where: { id: "fastqc-run-1" },
    });
    expect(mocks.db.pipelineRun.delete).not.toHaveBeenCalledWith({
      where: { id: "producer-run-1" },
    });
  });

  it("falls back to bulk delete when discovery succeeds but reads don't match", async () => {
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
        summary: { assembliesFound: 0, binsFound: 0, artifactsFound: 1, reportsFound: 0 },
      }),
    };

    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        outputs: [{ id: "sample_simulated_reads", destination: "sample_reads" }],
      },
    });
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    // Read has different file paths — discovery-based cleanup won't match
    mocks.db.read.findFirst.mockResolvedValue({
      id: "read-1",
      file1: "manual/S1_R1.fastq.gz",
      file2: "manual/S1_R2.fastq.gz",
    });
    mocks.db.read.findMany.mockResolvedValue([
      { id: "read-1", file1: "manual/S1_R1.fastq.gz", file2: "manual/S1_R2.fastq.gz" },
    ]);
    mocks.db.read.deleteMany.mockResolvedValue({ count: 1 });

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "simulate-reads",
      runFolder: "/tmp/run-1",
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });

    // Discovery-based cleanup should NOT have deleted the read (paths don't match)
    expect(mocks.db.read.delete).not.toHaveBeenCalled();
    // Fallback should have kicked in since this is the last run
    expect(mocks.db.read.deleteMany).toHaveBeenCalledWith({
      where: { sampleId: { in: ["sample-1"] } },
    });
    // Data files should be cleaned up via fallback
    expect(mocks.fs.rm).toHaveBeenCalledWith(
      "/data/sequencing/manual/S1_R1.fastq.gz",
      { force: true }
    );
  });

  it("falls back to bulk delete when discovery throws an error", async () => {
    const adapter = {
      discoverOutputs: vi.fn().mockRejectedValue(new Error("manifests dir missing")),
    };

    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        outputs: [{ id: "sample_simulated_reads", destination: "sample_reads" }],
      },
    });
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.db.read.findMany.mockResolvedValue([
      { id: "read-1", file1: "simulated/S1_R1.fastq.gz", file2: null },
    ]);
    mocks.db.read.deleteMany.mockResolvedValue({ count: 1 });

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "simulate-reads",
      runFolder: "/tmp/run-1",
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });

    // Fallback should delete reads
    expect(mocks.db.read.deleteMany).toHaveBeenCalledWith({
      where: { sampleId: { in: ["sample-1"] } },
    });
  });

  it("clears checksum fields when deleting a FASTQ Checksum run (discovery path)", async () => {
    const adapter = {
      discoverOutputs: vi.fn().mockResolvedValue({
        files: [
          {
            outputId: "sample_checksums",
            sampleId: "sample-1",
            metadata: {
              checksum1: "abc123",
              checksum2: "def456",
            },
          },
        ],
        errors: [],
        summary: { assembliesFound: 0, binsFound: 0, artifactsFound: 1, reportsFound: 0 },
      }),
    };

    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        inputs: [{ id: "reads", scope: "sample", source: "sample.reads", required: true }],
        outputs: [{ id: "sample_checksums", destination: "sample_reads" }],
      },
    });
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.db.read.findFirst.mockResolvedValue({
      id: "read-1",
      pipelineRunId: null,
      pipelineSources: '{"fastq-checksum":"run-1"}',
    });
    mocks.db.read.update.mockResolvedValue({});

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "fastq-checksum",
      runFolder: "/tmp/run-1",
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });

    // Should null out checksum fields, NOT delete the Read
    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-1" },
      data: { checksum1: null, checksum2: null },
    });
    expect(mocks.db.read.delete).not.toHaveBeenCalled();
    expect(mocks.db.read.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.pipelineRun.delete).not.toHaveBeenCalled();
  });

  it("clears checksum fields via fallback when deleting last FASTQ Checksum run", async () => {
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        inputs: [{ id: "reads", scope: "sample", source: "sample.reads", required: true }],
        outputs: [{ id: "sample_checksums", destination: "sample_reads" }],
      },
    });
    mocks.adapters.getAdapter.mockReturnValue(null);
    mocks.genericAdapter.createGenericAdapter.mockReturnValue(null);
    mocks.db.read.updateMany.mockResolvedValue({ count: 2 });
    mocks.db.pipelineRun.findMany.mockResolvedValueOnce([]);

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "fastq-checksum",
      runFolder: null,
      target: { type: "order", orderId: "order-1" },
      samples: [
        { id: "sample-1", sampleId: "S1" },
        { id: "sample-2", sampleId: "S2" },
      ],
    });

    // Should null out checksum fields on all samples, NOT delete reads
    expect(mocks.db.read.updateMany).toHaveBeenCalledWith({
      where: { sampleId: { in: ["sample-1", "sample-2"] } },
      data: { checksum1: null, checksum2: null },
    });
    expect(mocks.db.read.delete).not.toHaveBeenCalled();
    expect(mocks.db.read.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.pipelineRun.delete).not.toHaveBeenCalled();
  });

  it("does not clear metadata fields when a newer run is the active source", async () => {
    const adapter = {
      discoverOutputs: vi.fn().mockResolvedValue({
        files: [
          {
            outputId: "sample_checksums",
            sampleId: "sample-1",
            metadata: {
              checksum1: "abc123",
            },
          },
        ],
        errors: [],
        summary: { assembliesFound: 0, binsFound: 0, artifactsFound: 1, reportsFound: 0 },
      }),
    };

    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        inputs: [{ id: "reads", scope: "sample", source: "sample.reads", required: true }],
        outputs: [{ id: "sample_checksums", destination: "sample_reads" }],
      },
    });
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.db.read.findFirst.mockResolvedValue({
      id: "read-1",
      pipelineRunId: null,
      pipelineSources: '{"fastq-checksum":"run-2"}',
    });

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "fastq-checksum",
      runFolder: "/tmp/run-1",
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });

    expect(mocks.db.read.update).not.toHaveBeenCalled();
  });

  it("registers a generic adapter when no pipeline adapter exists", async () => {
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
        summary: { assembliesFound: 0, binsFound: 0, artifactsFound: 1, reportsFound: 0 },
      }),
    };

    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        outputs: [{ id: "sample_simulated_reads", destination: "sample_reads" }],
      },
    });
    mocks.adapters.getAdapter.mockReturnValue(null);
    mocks.genericAdapter.createGenericAdapter.mockReturnValue(adapter);
    mocks.db.read.findFirst.mockResolvedValue({
      id: "read-1",
      file1: "simulated/order_order-1/S1_R1.fastq.gz",
      file2: "simulated/order_order-1/S1_R2.fastq.gz",
      pipelineRunId: "run-1",
      pipelineSources: null,
    });

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "simulate-reads",
      runFolder: "/tmp/run-1",
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });

    expect(mocks.genericAdapter.createGenericAdapter).toHaveBeenCalledWith("simulate-reads");
    expect(mocks.adapters.registerAdapter).toHaveBeenCalledWith(adapter);
    expect(mocks.db.read.delete).toHaveBeenCalledWith({
      where: { id: "read-1" },
    });
  });

  it("ignores discovered files that are not declared sample read outputs", async () => {
    const adapter = {
      discoverOutputs: vi.fn().mockResolvedValue({
        files: [
          {
            outputId: "unrelated_output",
            sampleId: "sample-1",
            metadata: {
              file1: "simulated/order_order-1/S1_R1.fastq.gz",
            },
          },
        ],
        errors: [],
        summary: { assembliesFound: 0, binsFound: 0, artifactsFound: 1, reportsFound: 0 },
      }),
    };

    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        outputs: [{ id: "sample_simulated_reads", destination: "sample_reads" }],
      },
    });
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.db.pipelineRun.findMany.mockResolvedValue([{ inputSampleIds: null }]);

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "simulate-reads",
      runFolder: "/tmp/run-1",
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });

    expect(mocks.db.read.findFirst).not.toHaveBeenCalled();
    expect(mocks.db.read.delete).not.toHaveBeenCalled();
    expect(mocks.db.read.deleteMany).not.toHaveBeenCalled();
  });

  it("does not clean up outputs for packages that do not write sample reads", async () => {
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        outputs: [{ id: "assembly", destination: "assemblies" }],
      },
    });

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "assembly-pipeline",
      runFolder: "/tmp/run-1",
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });

    expect(mocks.db.pipelineRun.findMany).not.toHaveBeenCalled();
    expect(mocks.adapters.getAdapter).not.toHaveBeenCalled();
    expect(mocks.db.read.deleteMany).not.toHaveBeenCalled();
  });

  it("treats invalid selected sample metadata on overlapping runs as overlapping", async () => {
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        outputs: [{ id: "sample_simulated_reads", destination: "sample_reads" }],
      },
    });
    mocks.adapters.getAdapter.mockReturnValue(null);
    mocks.genericAdapter.createGenericAdapter.mockReturnValue(null);
    mocks.db.pipelineRun.findMany.mockResolvedValue([{ inputSampleIds: '{"sample":"bad"}' }]);

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "simulate-reads",
      runFolder: null,
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });

    expect(mocks.db.read.findMany).not.toHaveBeenCalled();
    expect(mocks.db.read.deleteMany).not.toHaveBeenCalled();
  });

  it("clears fastqc metadata via fallback without cascading dependent runs", async () => {
    mocks.packageLoader.getPackage.mockImplementation((id: string) => {
      if (id === "fastqc") {
        return {
          manifest: {
            inputs: [{ id: "reads", scope: "sample", source: "sample.reads", required: true }],
            outputs: [{ id: "sample_fastqc_reads", destination: "sample_reads" }],
          },
        };
      }
      if (id === "fastq-checksum") {
        return {
          manifest: {
            inputs: [{ id: "reads", scope: "sample", source: "sample.reads", required: true }],
            outputs: [{ id: "sample_checksums", destination: "sample_reads" }],
          },
        };
      }
      return null;
    });
    mocks.adapters.getAdapter.mockReturnValue(null);
    mocks.genericAdapter.createGenericAdapter.mockReturnValue(null);
    mocks.db.read.updateMany.mockResolvedValue({ count: 1 });

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "fastqc",
      runFolder: null,
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });

    expect(mocks.db.read.updateMany).toHaveBeenCalledWith({
      where: { sampleId: { in: ["sample-1"] } },
      data: {
        fastqcReport1: null,
        fastqcReport2: null,
        readCount1: null,
        readCount2: null,
        avgQuality1: null,
        avgQuality2: null,
      },
    });
    expect(mocks.db.pipelineRun.delete).not.toHaveBeenCalled();
  });

  it("cascade-deletes dependent runs for study-scoped cleanup", async () => {
    const adapter = {
      discoverOutputs: vi.fn().mockResolvedValue({
        files: [
          {
            outputId: "sample_simulated_reads",
            sampleId: "sample-1",
            metadata: {
              file1: "simulated/study_study-1/S1_R1.fastq.gz",
              file2: null,
            },
          },
        ],
        errors: [],
        summary: { assembliesFound: 0, binsFound: 0, artifactsFound: 1, reportsFound: 0 },
      }),
    };

    mocks.packageLoader.getPackage.mockImplementation((id: string) => {
      if (id === "simulate-reads") {
        return {
          manifest: {
            inputs: [],
            outputs: [{ id: "sample_simulated_reads", destination: "sample_reads" }],
          },
        };
      }
      if (id === "fastq-checksum") {
        return {
          manifest: {
            inputs: [{ id: "reads", scope: "sample", source: "sample.reads", required: true }],
            outputs: [{ id: "sample_checksums", destination: "sample_reads" }],
          },
        };
      }
      return null;
    });
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.db.read.findFirst.mockResolvedValue({
      id: "read-1",
      file1: "simulated/study_study-1/S1_R1.fastq.gz",
      file2: null,
      pipelineRunId: "run-1",
      pipelineSources: '{"simulate-reads":"run-1"}',
    });
    mocks.db.pipelineRun.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "checksum-run-1",
          pipelineId: "fastq-checksum",
          runFolder: "/tmp/checksum-run-1",
          inputSampleIds: '["sample-1"]',
        },
      ]);

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "simulate-reads",
      runFolder: "/tmp/run-1",
      target: { type: "study", studyId: "study-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });

    expect(mocks.db.pipelineRun.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        pipelineId: { not: "simulate-reads" },
        id: { not: "run-1" },
        studyId: "study-1",
      },
      select: { id: true, pipelineId: true, runFolder: true, inputSampleIds: true },
    });
    expect(mocks.db.pipelineRun.delete).toHaveBeenCalledWith({
      where: { id: "checksum-run-1" },
    });
  });

  it("deletes reads for all samples when last simulate-reads run is removed (multi-sample)", async () => {
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
          {
            outputId: "sample_simulated_reads",
            sampleId: "sample-2",
            metadata: {
              file1: "simulated/order_order-1/S2_R1.fastq.gz",
              file2: "simulated/order_order-1/S2_R2.fastq.gz",
            },
          },
        ],
        errors: [],
        summary: { assembliesFound: 0, binsFound: 0, artifactsFound: 2, reportsFound: 0 },
      }),
    };

    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        outputs: [{ id: "sample_simulated_reads", destination: "sample_reads" }],
      },
    });
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.db.read.findFirst
      .mockResolvedValueOnce({
        id: "read-1",
        file1: "simulated/order_order-1/S1_R1.fastq.gz",
        file2: "simulated/order_order-1/S1_R2.fastq.gz",
        pipelineRunId: "run-1",
        pipelineSources: '{"simulate-reads":"run-1"}',
      })
      .mockResolvedValueOnce({
        id: "read-2",
        file1: "simulated/order_order-1/S2_R1.fastq.gz",
        file2: "simulated/order_order-1/S2_R2.fastq.gz",
        pipelineRunId: "run-1",
        pipelineSources: '{"simulate-reads":"run-1"}',
      });

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "simulate-reads",
      runFolder: "/tmp/run-1",
      target: { type: "order", orderId: "order-1" },
      samples: [
        { id: "sample-1", sampleId: "S1" },
        { id: "sample-2", sampleId: "S2" },
      ],
    });

    expect(mocks.db.read.delete).toHaveBeenCalledWith({ where: { id: "read-1" } });
    expect(mocks.db.read.delete).toHaveBeenCalledWith({ where: { id: "read-2" } });
    expect(mocks.fs.rm).toHaveBeenCalledTimes(4);
  });

  it("does not clean up reads when deleting a non-last simulate-reads run", async () => {
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        outputs: [{ id: "sample_simulated_reads", destination: "sample_reads" }],
      },
    });
    mocks.adapters.getAdapter.mockReturnValue(null);
    mocks.genericAdapter.createGenericAdapter.mockReturnValue(null);
    // Another run for the same pipeline still exists
    mocks.db.pipelineRun.findMany.mockResolvedValue([{ inputSampleIds: null }]);

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "simulate-reads",
      runFolder: null,
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });

    expect(mocks.db.read.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.read.delete).not.toHaveBeenCalled();
    expect(mocks.fs.rm).not.toHaveBeenCalled();
  });

  it("clears fastqc metadata via discovery path when run is active source", async () => {
    const adapter = {
      discoverOutputs: vi.fn().mockResolvedValue({
        files: [
          {
            outputId: "sample_fastqc_reads",
            sampleId: "sample-1",
            metadata: {
              readCount1: 42000,
              readCount2: 42000,
              avgQuality1: 30.5,
              avgQuality2: 29.8,
              fastqcReport1: "/reports/S1_R1_fastqc.html",
              fastqcReport2: "/reports/S1_R2_fastqc.html",
            },
          },
        ],
        errors: [],
        summary: { assembliesFound: 0, binsFound: 0, artifactsFound: 1, reportsFound: 0 },
      }),
    };

    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        inputs: [{ id: "reads", scope: "sample", source: "sample.reads", required: true }],
        outputs: [{ id: "sample_fastqc_reads", destination: "sample_reads" }],
      },
    });
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.db.read.findFirst.mockResolvedValue({
      id: "read-1",
      pipelineRunId: null,
      pipelineSources: '{"fastqc":"run-1"}',
    });

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "fastqc",
      runFolder: "/tmp/run-1",
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });

    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-1" },
      data: {
        readCount1: null,
        readCount2: null,
        avgQuality1: null,
        avgQuality2: null,
        fastqcReport1: null,
        fastqcReport2: null,
      },
    });
    expect(mocks.db.read.delete).not.toHaveBeenCalled();
  });

  it("cascade-deletes both checksum and fastqc runs when simulate-reads is deleted", async () => {
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
        summary: { assembliesFound: 0, binsFound: 0, artifactsFound: 1, reportsFound: 0 },
      }),
    };

    mocks.packageLoader.getPackage.mockImplementation((id: string) => {
      if (id === "simulate-reads") {
        return {
          manifest: {
            inputs: [],
            outputs: [{ id: "sample_simulated_reads", destination: "sample_reads" }],
          },
        };
      }
      if (id === "fastq-checksum") {
        return {
          manifest: {
            inputs: [{ id: "reads", scope: "sample", source: "sample.reads", required: true }],
            outputs: [{ id: "sample_checksums", destination: "sample_reads" }],
          },
        };
      }
      if (id === "fastqc") {
        return {
          manifest: {
            inputs: [{ id: "reads", scope: "sample", source: "sample.reads", required: true }],
            outputs: [{ id: "sample_fastqc_reads", destination: "sample_reads" }],
          },
        };
      }
      return null;
    });
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.db.read.findFirst.mockResolvedValue({
      id: "read-1",
      file1: "simulated/order_order-1/S1_R1.fastq.gz",
      file2: "simulated/order_order-1/S1_R2.fastq.gz",
      pipelineRunId: "run-1",
      pipelineSources: '{"simulate-reads":"run-1"}',
    });
    mocks.db.pipelineRun.findMany
      .mockResolvedValueOnce([]) // no other simulate-reads runs
      .mockResolvedValueOnce([
        {
          id: "checksum-run-1",
          pipelineId: "fastq-checksum",
          runFolder: "/tmp/checksum-run-1",
          inputSampleIds: '["sample-1"]',
        },
        {
          id: "fastqc-run-1",
          pipelineId: "fastqc",
          runFolder: "/tmp/fastqc-run-1",
          inputSampleIds: '["sample-1"]',
        },
      ]);

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "simulate-reads",
      runFolder: "/tmp/run-1",
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });

    // Both dependent runs should be cascade-deleted
    expect(mocks.db.pipelineRun.delete).toHaveBeenCalledWith({ where: { id: "checksum-run-1" } });
    expect(mocks.db.pipelineRun.delete).toHaveBeenCalledWith({ where: { id: "fastqc-run-1" } });
    expect(mocks.db.pipelineRunStep.deleteMany).toHaveBeenCalledWith({
      where: { pipelineRunId: "checksum-run-1" },
    });
    expect(mocks.db.pipelineRunStep.deleteMany).toHaveBeenCalledWith({
      where: { pipelineRunId: "fastqc-run-1" },
    });
    // Run folders should be cleaned up
    expect(mocks.fs.rm).toHaveBeenCalledWith("/tmp/checksum-run-1", { recursive: true, force: true });
    expect(mocks.fs.rm).toHaveBeenCalledWith("/tmp/fastqc-run-1", { recursive: true, force: true });
  });

  it("does not cascade-delete checksum/fastqc when non-last simulate-reads run is deleted", async () => {
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
        summary: { assembliesFound: 0, binsFound: 0, artifactsFound: 1, reportsFound: 0 },
      }),
    };

    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        outputs: [{ id: "sample_simulated_reads", destination: "sample_reads" }],
      },
    });
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    // Read was relinked to run-2, so discovery-based cleanup won't match
    mocks.db.read.findFirst.mockResolvedValue({
      id: "read-1",
      file1: "simulated/order_order-1/S1_R1.fastq.gz",
      file2: "simulated/order_order-1/S1_R2.fastq.gz",
      pipelineRunId: "run-2",
      pipelineSources: '{"simulate-reads":"run-2"}',
    });
    // Another run still exists
    mocks.db.pipelineRun.findMany.mockResolvedValueOnce([{ inputSampleIds: null }]);

    await cleanupRunOutputData({
      runId: "run-1",
      pipelineId: "simulate-reads",
      runFolder: "/tmp/run-1",
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });

    // Should not delete reads or cascade
    expect(mocks.db.read.delete).not.toHaveBeenCalled();
    expect(mocks.db.read.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.pipelineRun.delete).not.toHaveBeenCalled();
  });
});
