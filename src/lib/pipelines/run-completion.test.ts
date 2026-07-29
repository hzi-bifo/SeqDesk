import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    pipelineRun: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  getAdapter: vi.fn(),
  registerAdapter: vi.fn(),
  createGenericAdapter: vi.fn(),
  resolveOutputs: vi.fn(),
  saveRunResults: vi.fn(),
  processSubmgRunResults: vi.fn(),
  getPackage: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("./adapters", () => ({
  getAdapter: mocks.getAdapter,
  registerAdapter: mocks.registerAdapter,
}));

vi.mock("./generic-adapter", () => ({
  createGenericAdapter: mocks.createGenericAdapter,
}));

vi.mock("./output-resolver", () => ({
  resolveOutputs: mocks.resolveOutputs,
  saveRunResults: mocks.saveRunResults,
}));

vi.mock("./submg/submg-runner", () => ({
  processSubmgRunResults: mocks.processSubmgRunResults,
}));

vi.mock("./package-loader", () => ({
  getPackage: mocks.getPackage,
}));

import {
  finalizeCompletedPipelineRun,
  inferPipelineExitCode,
  processCompletedPipelineRun,
} from "./run-completion";

let tempDir: string;

describe("run-completion", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-run-completion-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("validates submg outputs and result processing before completing", async () => {
    const runFolder = path.join(tempDir, "submg-run");
    await fs.mkdir(
      path.join(runFolder, "logging_0", "biological_samples"),
      { recursive: true }
    );
    await fs.writeFile(
      path.join(runFolder, "submg-metadata.json"),
      JSON.stringify({
        submission: {
          samples: true,
          reads: false,
          assembly: false,
          bins: false,
        },
        entries: [
          {
            index: 0,
            sampleId: "sample-1",
            readIds: [],
            assemblyId: null,
            bins: [],
          },
        ],
      })
    );
    await fs.writeFile(
      path.join(
        runFolder,
        "logging_0",
        "biological_samples",
        "sample_preliminary_accessions.txt"
      ),
      "alias\taccession\texternal_accession\nSAMPLE-1\tERS1\tSAMEA1\n"
    );
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder,
      targetType: "study",
      studyId: "study-1",
      orderId: null,
      study: { samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }] },
      order: null,
    });
    mocks.processSubmgRunResults.mockResolvedValue({
      samplesUpdated: 1,
      readsUpdated: 1,
      assembliesUpdated: 0,
      binsUpdated: 0,
      artifactsCreated: 2,
      errors: [],
      warnings: [],
    });

    await processCompletedPipelineRun("run-1", "submg");

    expect(mocks.processSubmgRunResults).toHaveBeenCalledWith("run-1");
    expect(mocks.getAdapter).not.toHaveBeenCalled();
    expect(mocks.resolveOutputs).not.toHaveBeenCalled();
  });

  it("rejects submg receipts that produce no required accession writeback", async () => {
    const runFolder = path.join(tempDir, "submg-no-writeback");
    await fs.mkdir(
      path.join(runFolder, "logging_0", "biological_samples"),
      { recursive: true }
    );
    await fs.writeFile(
      path.join(runFolder, "submg-metadata.json"),
      JSON.stringify({
        submission: {
          samples: true,
          reads: false,
          assembly: false,
          bins: false,
        },
        entries: [
          {
            index: 0,
            sampleId: "sample-1",
            readIds: [],
            assemblyId: null,
            bins: [],
          },
        ],
      })
    );
    await fs.writeFile(
      path.join(
        runFolder,
        "logging_0",
        "biological_samples",
        "sample_preliminary_accessions.txt"
      ),
      "alias\taccession\texternal_accession\nSAMPLE-1\tERS1\tSAMEA1\n"
    );
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-submg-no-writeback",
      runFolder,
      targetType: "study",
      studyId: "study-1",
      orderId: null,
      study: { samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }] },
      order: null,
    });
    mocks.processSubmgRunResults.mockResolvedValue({
      samplesUpdated: 0,
      readsUpdated: 0,
      assembliesUpdated: 0,
      binsUpdated: 0,
      artifactsCreated: 2,
      errors: [],
      warnings: [],
    });

    await expect(
      processCompletedPipelineRun("run-submg-no-writeback", "submg")
    ).rejects.toThrow("missing accession writebacks: samples 0/1");
  });

  it("keeps submg retryable until every metadata entry has logging output", async () => {
    const runFolder = path.join(tempDir, "submg-partial");
    await fs.mkdir(
      path.join(runFolder, "logging_0", "biological_samples"),
      { recursive: true }
    );
    await fs.writeFile(
      path.join(runFolder, "submg-metadata.json"),
      JSON.stringify({
        submission: {
          samples: true,
          reads: false,
          assembly: false,
          bins: false,
        },
        entries: [
          {
            index: 0,
            sampleId: "sample-1",
            readIds: [],
            assemblyId: null,
            bins: [],
          },
          {
            index: 1,
            sampleId: "sample-2",
            readIds: [],
            assemblyId: null,
            bins: [],
          },
        ],
      })
    );
    await fs.writeFile(
      path.join(
        runFolder,
        "logging_0",
        "biological_samples",
        "sample_preliminary_accessions.txt"
      ),
      "alias\taccession\texternal_accession\nSAMPLE-1\tERS1\tSAMEA1\n"
    );
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-submg-partial",
      runFolder,
      targetType: "study",
      studyId: "study-1",
      orderId: null,
      study: {
        samples: [
          { id: "sample-1", sampleId: "SAMPLE-1" },
          { id: "sample-2", sampleId: "SAMPLE-2" },
        ],
      },
      order: null,
    });

    await expect(
      processCompletedPipelineRun("run-submg-partial", "submg")
    ).rejects.toThrow("missing required accession receipts");

    expect(mocks.processSubmgRunResults).not.toHaveBeenCalled();
  }, 5_000);

  it("does not accept an unrelated nonempty submg log as a submission receipt", async () => {
    const runFolder = path.join(tempDir, "submg-unrelated-log");
    await fs.mkdir(path.join(runFolder, "logging_0"), { recursive: true });
    await fs.writeFile(
      path.join(runFolder, "submg-metadata.json"),
      JSON.stringify({
        submission: {
          samples: true,
          reads: false,
          assembly: false,
          bins: false,
        },
        entries: [
          {
            index: 0,
            sampleId: "sample-1",
            readIds: [],
            assemblyId: null,
            bins: [],
          },
        ],
      })
    );
    await fs.writeFile(
      path.join(runFolder, "logging_0", "debug.log"),
      "submg started"
    );
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-submg-unrelated",
      runFolder,
      targetType: "study",
      studyId: "study-1",
      orderId: null,
      study: { samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }] },
      order: null,
    });

    const nativeSetTimeout = globalThis.setTimeout;
    vi.useFakeTimers();
    try {
      const promise = processCompletedPipelineRun(
        "run-submg-unrelated",
        "submg"
      );
      let settled = false;
      void promise.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      const expectation = expect(promise).rejects.toThrow(
        "missing required accession receipts"
      );
      for (let iteration = 0; iteration < 10 && !settled; iteration += 1) {
        // Filesystem promises use the real event loop; allow each inspection to
        // reach its settle timer before advancing the fake clock.
        await new Promise((resolve) => nativeSetTimeout(resolve, 5));
        if (vi.getTimerCount() > 0) {
          await vi.runOnlyPendingTimersAsync();
        }
      }
      await expectation;
    } finally {
      vi.useRealTimers();
    }

    expect(mocks.processSubmgRunResults).not.toHaveBeenCalled();
  });

  it("rejects when no output adapter is available", async () => {
    mocks.getAdapter.mockReturnValue(null);
    mocks.createGenericAdapter.mockReturnValue(null);

    await expect(
      processCompletedPipelineRun("run-1", "mag")
    ).rejects.toThrow("has no output adapter");

    expect(mocks.db.pipelineRun.findUnique).not.toHaveBeenCalled();
    expect(mocks.registerAdapter).not.toHaveBeenCalled();
    expect(mocks.resolveOutputs).not.toHaveBeenCalled();
  });

  it("registers and uses a generic adapter when no static adapter exists", async () => {
    const discovered = {
      files: [
        {
          type: "artifact",
          name: "report.txt",
          path: "/tmp/report.txt",
        },
      ],
      errors: [],
      summary: {
        assembliesFound: 0,
        binsFound: 0,
        artifactsFound: 1,
        reportsFound: 0,
      },
    };
    const adapter = {
      discoverOutputs: vi.fn().mockResolvedValue(discovered),
    };
    const resolved = {
      success: true,
      assembliesCreated: 0,
      binsCreated: 0,
      artifactsCreated: 1,
      errors: [],
      warnings: [],
    };

    mocks.getAdapter.mockReturnValue(null);
    mocks.createGenericAdapter.mockReturnValue(adapter);
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder: "/tmp/run-1",
      targetType: "study",
      studyId: "study-1",
      orderId: null,
      study: {
        samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }],
      },
      order: null,
    });
    mocks.resolveOutputs.mockResolvedValue(resolved);
    mocks.saveRunResults.mockResolvedValue(undefined);

    await processCompletedPipelineRun("run-1", "mag");

    expect(mocks.registerAdapter).toHaveBeenCalledWith(adapter);
    expect(adapter.discoverOutputs).toHaveBeenCalledWith({
      runId: "run-1",
      outputDir: path.join("/tmp/run-1", "output"),
      target: { type: "study", studyId: "study-1" },
      samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }],
    });
    expect(mocks.resolveOutputs).toHaveBeenCalledWith("mag", "run-1", discovered);
    expect(mocks.saveRunResults).toHaveBeenCalledWith("run-1", resolved);
  });

  it("uses order samples when processing an order-targeted run", async () => {
    const discovered = {
      files: [],
      errors: [],
      summary: {
        assembliesFound: 0,
        binsFound: 0,
        artifactsFound: 0,
        reportsFound: 0,
      },
    };
    const adapter = {
      discoverOutputs: vi.fn().mockResolvedValue(discovered),
    };

    mocks.getAdapter.mockReturnValue(adapter);
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-2",
      runFolder: "/tmp/run-2",
      targetType: "order",
      studyId: null,
      orderId: "order-9",
      study: null,
      order: {
        samples: [{ id: "sample-9", sampleId: "ORDER-SAMPLE-9" }],
      },
    });
    mocks.resolveOutputs.mockResolvedValue({
      success: true,
      assembliesCreated: 0,
      binsCreated: 0,
      artifactsCreated: 0,
      errors: [],
      warnings: [],
    });
    mocks.saveRunResults.mockResolvedValue(undefined);

    await processCompletedPipelineRun("run-2", "fastq-checksum");

    expect(adapter.discoverOutputs).toHaveBeenCalledWith({
      runId: "run-2",
      outputDir: path.join("/tmp/run-2", "output"),
      target: { type: "order", orderId: "order-9" },
      samples: [{ id: "sample-9", sampleId: "ORDER-SAMPLE-9" }],
    });
  });

  it("re-scans for a run-scoped summary that is not yet flushed when finalizing (NFS-flush race)", async () => {
    // Reproduces the documented monitor flake: the run-scoped summary artifact
    // (fastqc 'summary', manifest scope:'run') is written by the LAST process and
    // is not yet visible on shared NFS at the instant the finalizer scans. The
    // first discoverOutputs returns only the per-sample report; the summary file
    // becomes visible on a later scan. The settle-retry must pick it up so the
    // run-scoped row is ingested instead of being permanently missing.
    const perSampleOnly = {
      files: [
        {
          type: "report",
          name: "SAMPLE-1_R1_fastqc.html",
          path: "/tmp/run-1/output/fastqc_reports/SAMPLE-1_R1_fastqc.html",
          outputId: "sample_qc_reports",
          sampleId: "sample-1",
        },
      ],
      errors: [],
      summary: { assembliesFound: 0, binsFound: 0, artifactsFound: 0, reportsFound: 1 },
    };
    const withSummary = {
      files: [
        ...perSampleOnly.files,
        {
          type: "artifact",
          name: "fastqc-summary.tsv",
          path: "/tmp/run-1/output/summary/fastqc-summary.tsv",
          outputId: "summary",
        },
      ],
      errors: [],
      summary: { assembliesFound: 0, binsFound: 0, artifactsFound: 1, reportsFound: 1 },
    };

    const adapter = {
      // First scan: summary not yet flushed. Second scan: it has appeared.
      discoverOutputs: vi
        .fn()
        .mockResolvedValueOnce(perSampleOnly)
        .mockResolvedValueOnce(withSummary),
    };

    // fastqc declares a run-scoped output id 'summary' that must be present.
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          { id: "sample_qc_reports", scope: "sample" },
          { id: "summary", scope: "run" },
        ],
      },
    });

    mocks.getAdapter.mockReturnValue(adapter);
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder: "/tmp/run-1",
      targetType: "study",
      studyId: "study-1",
      orderId: null,
      study: { samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }] },
      order: null,
    });
    mocks.resolveOutputs.mockResolvedValue({
      success: true,
      assembliesCreated: 0,
      binsCreated: 0,
      artifactsCreated: 2,
      errors: [],
      warnings: [],
    });
    mocks.saveRunResults.mockResolvedValue(undefined);

    // Drive the bounded settle delay with fake timers so the test is instant.
    vi.useFakeTimers();
    try {
      const promise = processCompletedPipelineRun("run-1", "fastqc");
      await vi.runAllTimersAsync();
      await promise;
    } finally {
      vi.useRealTimers();
    }

    // It re-scanned (the first scan missed the late summary).
    expect(adapter.discoverOutputs).toHaveBeenCalledTimes(2);
    // resolveOutputs received the SECOND (complete) discovery, so the run-scoped
    // summary artifact is ingested rather than being permanently dropped.
    expect(mocks.resolveOutputs).toHaveBeenCalledTimes(1);
    expect(mocks.resolveOutputs).toHaveBeenCalledWith("fastqc", "run-1", withSummary);
    expect(
      withSummary.files.some((f) => f.outputId === "summary")
    ).toBe(true);
  });

  it("does not re-scan when all declared run-scoped outputs are present on the first scan", async () => {
    const complete = {
      files: [
        {
          type: "artifact",
          name: "fastqc-summary.tsv",
          path: "/tmp/run-1/output/summary/fastqc-summary.tsv",
          outputId: "summary",
        },
      ],
      errors: [],
      summary: { assembliesFound: 0, binsFound: 0, artifactsFound: 1, reportsFound: 0 },
    };
    const adapter = { discoverOutputs: vi.fn().mockResolvedValue(complete) };

    mocks.getPackage.mockReturnValue({
      manifest: { outputs: [{ id: "summary", scope: "run" }] },
    });
    mocks.getAdapter.mockReturnValue(adapter);
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder: "/tmp/run-1",
      targetType: "study",
      studyId: "study-1",
      orderId: null,
      study: { samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }] },
      order: null,
    });
    mocks.resolveOutputs.mockResolvedValue({
      success: true,
      assembliesCreated: 0,
      binsCreated: 0,
      artifactsCreated: 1,
      errors: [],
      warnings: [],
    });
    mocks.saveRunResults.mockResolvedValue(undefined);

    await processCompletedPipelineRun("run-1", "fastqc");

    // Healthy run: present on first scan -> exactly one scan, no settle delay.
    expect(adapter.discoverOutputs).toHaveBeenCalledTimes(1);
  });

  it("rejects instead of resolving a partial result when a required run output never appears", async () => {
    const perSampleOnly = {
      files: [
        {
          type: "artifact",
          name: "SAMPLE-1_R1_fastqc.html",
          path: "/tmp/run-1/output/fastqc_reports/SAMPLE-1_R1_fastqc.html",
          outputId: "sample_qc_reports",
          sampleId: "sample-1",
        },
      ],
      errors: ["FastQC summary file was not produced"],
      summary: { assembliesFound: 0, binsFound: 0, artifactsFound: 1, reportsFound: 1 },
    };
    const adapter = {
      discoverOutputs: vi.fn().mockResolvedValue(perSampleOnly),
    };
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          { id: "sample_qc_reports", scope: "sample" },
          { id: "summary", scope: "run" },
        ],
      },
    });
    mocks.getAdapter.mockReturnValue(adapter);
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder: "/tmp/run-1",
      targetType: "order",
      studyId: null,
      orderId: "order-1",
      study: null,
      order: { samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }] },
    });

    vi.useFakeTimers();
    try {
      const promise = processCompletedPipelineRun("run-1", "fastqc");
      const expectation = expect(promise).rejects.toThrow(
        "missing required output(s) after 3 discovery attempts: summary"
      );
      await vi.runAllTimersAsync();
      await expectation;
    } finally {
      vi.useRealTimers();
    }

    expect(adapter.discoverOutputs).toHaveBeenCalledTimes(3);
    expect(mocks.resolveOutputs).not.toHaveBeenCalled();
    expect(mocks.saveRunResults).not.toHaveBeenCalled();
  });

  it("requires each sample-scoped output for every target sample", async () => {
    const onlyFirstSample = {
      files: [
        {
          type: "artifact",
          name: "SAMPLE-1.tsv",
          path: "/tmp/run-1/output/per_sample/SAMPLE-1.tsv",
          outputId: "sample_stats",
          sampleId: "sample-1",
        },
      ],
      errors: [],
      summary: {
        assembliesFound: 0,
        binsFound: 0,
        artifactsFound: 1,
        reportsFound: 0,
      },
    };
    const adapter = {
      discoverOutputs: vi.fn().mockResolvedValue(onlyFirstSample),
    };
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [{ id: "sample_stats", scope: "sample" }],
      },
    });
    mocks.getAdapter.mockReturnValue(adapter);
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder: "/tmp/run-1",
      targetType: "study",
      studyId: "study-1",
      orderId: null,
      study: {
        samples: [
          { id: "sample-1", sampleId: "SAMPLE-1" },
          { id: "sample-2", sampleId: "SAMPLE-2" },
        ],
      },
      order: null,
    });

    vi.useFakeTimers();
    try {
      const promise = processCompletedPipelineRun("run-1", "reads-qc");
      const expectation = expect(promise).rejects.toThrow(
        "sample_stats[sample:SAMPLE-2]"
      );
      await vi.runAllTimersAsync();
      await expectation;
    } finally {
      vi.useRealTimers();
    }

    expect(adapter.discoverOutputs).toHaveBeenCalledTimes(3);
    expect(mocks.resolveOutputs).not.toHaveBeenCalled();
  });

  it("requires sample-scoped outputs only for samples selected on the run", async () => {
    const selectedSampleOutput = {
      files: [
        {
          type: "artifact",
          name: "SAMPLE-1.tsv",
          path: "/tmp/run-subset/output/per_sample/SAMPLE-1.tsv",
          outputId: "sample_stats",
          sampleId: "sample-1",
        },
      ],
      errors: [],
      summary: {
        assembliesFound: 0,
        binsFound: 0,
        artifactsFound: 1,
        reportsFound: 0,
      },
    };
    const adapter = {
      discoverOutputs: vi.fn().mockResolvedValue(selectedSampleOutput),
    };
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [{ id: "sample_stats", scope: "sample" }],
      },
    });
    mocks.getAdapter.mockReturnValue(adapter);
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-subset",
      runFolder: "/tmp/run-subset",
      targetType: "study",
      studyId: "study-1",
      orderId: null,
      inputSampleIds: JSON.stringify(["sample-1"]),
      study: {
        samples: [
          { id: "sample-1", sampleId: "SAMPLE-1" },
          { id: "sample-2", sampleId: "SAMPLE-2" },
        ],
      },
      order: null,
    });
    mocks.resolveOutputs.mockResolvedValue({
      success: true,
      assembliesCreated: 0,
      binsCreated: 0,
      artifactsCreated: 1,
      errors: [],
      warnings: [],
    });
    mocks.saveRunResults.mockResolvedValue(undefined);

    await processCompletedPipelineRun("run-subset", "reads-qc");

    expect(adapter.discoverOutputs).toHaveBeenCalledWith(
      expect.objectContaining({
        samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }],
      })
    );
    expect(mocks.resolveOutputs).toHaveBeenCalledWith(
      "reads-qc",
      "run-subset",
      selectedSampleOutput
    );
  });

  it("does not require outputs explicitly declared optional", async () => {
    const discovered = {
      files: [],
      errors: [],
      summary: {
        assembliesFound: 0,
        binsFound: 0,
        artifactsFound: 0,
        reportsFound: 0,
      },
    };
    const adapter = {
      discoverOutputs: vi.fn().mockResolvedValue(discovered),
    };
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [{ id: "bins", scope: "sample", required: false }],
      },
    });
    mocks.getAdapter.mockReturnValue(adapter);
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-mag",
      runFolder: "/tmp/run-mag",
      targetType: "study",
      studyId: "study-1",
      orderId: null,
      study: {
        samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }],
      },
      order: null,
    });
    mocks.resolveOutputs.mockResolvedValue({
      success: true,
      assembliesCreated: 0,
      binsCreated: 0,
      artifactsCreated: 0,
      errors: [],
      warnings: [],
    });
    mocks.saveRunResults.mockResolvedValue(undefined);

    await processCompletedPipelineRun("run-mag", "mag");

    expect(adapter.discoverOutputs).toHaveBeenCalledTimes(1);
    expect(mocks.resolveOutputs).toHaveBeenCalledWith(
      "mag",
      "run-mag",
      discovered
    );
  });

  it("requires config-controlled optional outputs when their branch is enabled", async () => {
    const discovered = {
      files: [],
      errors: [],
      summary: {
        assembliesFound: 0,
        binsFound: 0,
        artifactsFound: 0,
        reportsFound: 0,
      },
    };
    const adapter = {
      discoverOutputs: vi.fn().mockResolvedValue(discovered),
    };
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          { id: "removed_reads", scope: "sample", required: false },
        ],
      },
    });
    mocks.getAdapter.mockReturnValue(adapter);
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-read-cleaning",
      runFolder: "/tmp/run-read-cleaning",
      targetType: "study",
      studyId: "study-1",
      orderId: null,
      config: JSON.stringify({ outputRemovedReads: true }),
      study: {
        samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }],
      },
      order: null,
    });

    vi.useFakeTimers();
    try {
      const promise = processCompletedPipelineRun(
        "run-read-cleaning",
        "read-cleaning"
      );
      const expectation = expect(promise).rejects.toThrow(
        "removed_reads[sample:SAMPLE-1]"
      );
      await vi.runAllTimersAsync();
      await expectation;
    } finally {
      vi.useRealTimers();
    }

    expect(mocks.resolveOutputs).not.toHaveBeenCalled();
  });

  it("allows a disabled config-controlled optional output to be absent", async () => {
    const discovered = {
      files: [],
      errors: [],
      summary: {
        assembliesFound: 0,
        binsFound: 0,
        artifactsFound: 0,
        reportsFound: 0,
      },
    };
    const adapter = {
      discoverOutputs: vi.fn().mockResolvedValue(discovered),
    };
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [{ id: "krona_html", scope: "sample", required: false }],
      },
    });
    mocks.getAdapter.mockReturnValue(adapter);
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-krona-disabled",
      runFolder: "/tmp/run-krona-disabled",
      targetType: "study",
      studyId: "study-1",
      orderId: null,
      config: JSON.stringify({ krona: false }),
      study: {
        samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }],
      },
      order: null,
    });
    mocks.resolveOutputs.mockResolvedValue({
      success: true,
      assembliesCreated: 0,
      binsCreated: 0,
      artifactsCreated: 0,
      errors: [],
      warnings: [],
    });
    mocks.saveRunResults.mockResolvedValue(undefined);

    await processCompletedPipelineRun(
      "run-krona-disabled",
      "kraken2-bracken"
    );

    expect(adapter.discoverOutputs).toHaveBeenCalledTimes(1);
    expect(mocks.resolveOutputs).toHaveBeenCalledWith(
      "kraken2-bracken",
      "run-krona-disabled",
      discovered
    );
  });

  it("persists resolver diagnostics but rejects an unsuccessful output resolution", async () => {
    const discovered = {
      files: [],
      errors: [],
      summary: { assembliesFound: 0, binsFound: 0, artifactsFound: 0, reportsFound: 0 },
    };
    const adapter = { discoverOutputs: vi.fn().mockResolvedValue(discovered) };
    const failedResult = {
      success: false,
      assembliesCreated: 0,
      binsCreated: 0,
      artifactsCreated: 0,
      errors: ["sample SAMPLE-1 could not be matched"],
      warnings: [],
    };
    mocks.getPackage.mockReturnValue({ manifest: { outputs: [] } });
    mocks.getAdapter.mockReturnValue(adapter);
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-2",
      runFolder: "/tmp/run-2",
      targetType: "order",
      studyId: null,
      orderId: "order-2",
      study: null,
      order: { samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }] },
    });
    mocks.resolveOutputs.mockResolvedValue(failedResult);
    mocks.saveRunResults.mockResolvedValue(undefined);

    await expect(
      processCompletedPipelineRun("run-2", "fastq-checksum")
    ).rejects.toThrow("sample SAMPLE-1 could not be matched");

    expect(mocks.saveRunResults).toHaveBeenCalledWith("run-2", failedResult);
  });

  it("rejects when run state cannot support output resolution", async () => {
    const adapter = {
      discoverOutputs: vi.fn(),
    };
    mocks.getAdapter.mockReturnValue(adapter);
    mocks.db.pipelineRun.findUnique.mockResolvedValueOnce({
      id: "run-1",
      runFolder: null,
      targetType: "study",
      studyId: "study-1",
      orderId: null,
      study: { samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }] },
      order: null,
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValueOnce({
      id: "run-1",
      runFolder: "/tmp/run-1",
      targetType: "study",
      studyId: "study-1",
      orderId: null,
      study: { samples: [] },
      order: null,
    });

    await expect(
      processCompletedPipelineRun("run-1", "mag")
    ).rejects.toThrow("has no run folder");
    await expect(
      processCompletedPipelineRun("run-1", "mag")
    ).rejects.toThrow("has no target samples");

    expect(adapter.discoverOutputs).not.toHaveBeenCalled();
    expect(mocks.resolveOutputs).not.toHaveBeenCalled();
  });

  it("keeps submg retryable when specialized result processing reports issues", async () => {
    const runFolder = path.join(tempDir, "submg-failed");
    await fs.mkdir(
      path.join(runFolder, "logging_0", "biological_samples"),
      { recursive: true }
    );
    await fs.writeFile(
      path.join(runFolder, "submg-metadata.json"),
      JSON.stringify({
        submission: {
          samples: true,
          reads: false,
          assembly: false,
          bins: false,
        },
        entries: [
          {
            index: 0,
            sampleId: "sample-1",
            readIds: [],
            assemblyId: null,
            bins: [],
          },
        ],
      })
    );
    await fs.writeFile(
      path.join(
        runFolder,
        "logging_0",
        "biological_samples",
        "sample_preliminary_accessions.txt"
      ),
      "alias\taccession\texternal_accession\nSAMPLE-1\tERS1\tSAMEA1\n"
    );
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-submg",
      runFolder,
      targetType: "study",
      studyId: "study-1",
      orderId: null,
      study: { samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }] },
      order: null,
    });
    mocks.processSubmgRunResults.mockResolvedValue({
      samplesUpdated: 0,
      readsUpdated: 0,
      assembliesUpdated: 0,
      binsUpdated: 0,
      artifactsCreated: 2,
      errors: [],
      warnings: ["Could not map read report"],
    });

    await expect(
      processCompletedPipelineRun("run-submg", "submg")
    ).rejects.toThrow("Could not map read report");
  });

  describe("finalizeCompletedPipelineRun", () => {
    it("claims output finalization and commits completion after processing outputs", async () => {
      const completedAt = new Date("2026-07-29T12:00:00.000Z");
      const lastEventAt = new Date("2026-07-29T12:00:01.000Z");
      const queueUpdatedAt = new Date("2026-07-29T12:00:02.000Z");
      const discovered = {
        files: [],
        errors: [],
        summary: {
          assembliesFound: 0,
          binsFound: 0,
          artifactsFound: 0,
          reportsFound: 0,
        },
      };
      const adapter = {
        discoverOutputs: vi.fn().mockResolvedValue(discovered),
      };
      const resolved = {
        success: true,
        assembliesCreated: 0,
        binsCreated: 0,
        artifactsCreated: 0,
        errors: [],
        warnings: [],
      };

      mocks.db.pipelineRun.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 1 });
      mocks.getAdapter.mockReturnValue(adapter);
      mocks.getPackage.mockReturnValue({ manifest: { outputs: [] } });
      mocks.db.pipelineRun.findUnique.mockResolvedValue({
        id: "run-finalize-success",
        runFolder: "/tmp/run-finalize-success",
        targetType: "study",
        studyId: "study-1",
        orderId: null,
        inputSampleIds: null,
        config: null,
        study: { samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }] },
        order: null,
      });
      mocks.resolveOutputs.mockResolvedValue(resolved);
      mocks.saveRunResults.mockResolvedValue(undefined);

      const result = await finalizeCompletedPipelineRun(
        "run-finalize-success",
        "fastq-checksum",
        {
          completedAt,
          statusSource: "weblog",
          lastEventAt,
          queueStatus: "COMPLETED",
          queueReason: null,
          queueUpdatedAt,
        }
      );

      expect(result).toBe("completed");
      expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledTimes(2);
      expect(mocks.db.pipelineRun.updateMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({
            id: "run-finalize-success",
            status: { in: ["pending", "queued", "running"] },
          }),
          data: expect.objectContaining({
            statusSource: "finalizing",
            currentStep: "Finalizing outputs...",
            progress: 99,
            completedAt: null,
            lastEventAt: expect.any(Date),
          }),
        })
      );
      expect(adapter.discoverOutputs).toHaveBeenCalledTimes(1);
      expect(mocks.resolveOutputs).toHaveBeenCalledWith(
        "fastq-checksum",
        "run-finalize-success",
        discovered
      );
      expect(mocks.saveRunResults).toHaveBeenCalledWith(
        "run-finalize-success",
        resolved
      );
      const claimedAt =
        mocks.db.pipelineRun.updateMany.mock.calls[0]?.[0]?.data?.lastEventAt;
      expect(claimedAt).toBeInstanceOf(Date);
      expect(mocks.db.pipelineRun.updateMany).toHaveBeenNthCalledWith(2, {
        where: {
          id: "run-finalize-success",
          status: { in: ["pending", "queued", "running"] },
          statusSource: "finalizing",
          lastEventAt: claimedAt,
        },
        data: {
          status: "completed",
          progress: 100,
          currentStep: "Completed",
          completedAt,
          statusSource: "weblog",
          lastEventAt,
          queueStatus: "COMPLETED",
          queueReason: null,
          queueUpdatedAt,
        },
      });
    });

    it("returns claim-unavailable without performing output work", async () => {
      mocks.db.pipelineRun.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await finalizeCompletedPipelineRun(
        "run-finalize-owned",
        "fastq-checksum"
      );

      expect(result).toBe("claim-unavailable");
      expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledTimes(1);
      expect(mocks.getAdapter).not.toHaveBeenCalled();
      expect(mocks.createGenericAdapter).not.toHaveBeenCalled();
      expect(mocks.db.pipelineRun.findUnique).not.toHaveBeenCalled();
      expect(mocks.resolveOutputs).not.toHaveBeenCalled();
      expect(mocks.saveRunResults).not.toHaveBeenCalled();
    });

    it("renews the finalization lease while output processing is still running", async () => {
      vi.useFakeTimers();
      try {
        const discovered = {
          files: [],
          errors: [],
          summary: {
            assembliesFound: 0,
            binsFound: 0,
            artifactsFound: 0,
            reportsFound: 0,
          },
        };
        let releaseDiscovery!: (value: typeof discovered) => void;
        let markDiscoveryStarted!: () => void;
        const discoveryStarted = new Promise<void>((resolve) => {
          markDiscoveryStarted = resolve;
        });
        const pendingDiscovery = new Promise<typeof discovered>((resolve) => {
          releaseDiscovery = resolve;
        });
        const adapter = {
          discoverOutputs: vi.fn().mockImplementation(() => {
            markDiscoveryStarted();
            return pendingDiscovery;
          }),
        };
        const resolved = {
          success: true,
          assembliesCreated: 0,
          binsCreated: 0,
          artifactsCreated: 0,
          errors: [],
          warnings: [],
        };

        mocks.db.pipelineRun.updateMany.mockResolvedValue({ count: 1 });
        mocks.getAdapter.mockReturnValue(adapter);
        mocks.getPackage.mockReturnValue({ manifest: { outputs: [] } });
        mocks.db.pipelineRun.findUnique.mockResolvedValue({
          id: "run-finalize-heartbeat",
          runFolder: "/tmp/run-finalize-heartbeat",
          targetType: "study",
          studyId: "study-1",
          orderId: null,
          inputSampleIds: null,
          config: null,
          study: { samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }] },
          order: null,
        });
        mocks.resolveOutputs.mockResolvedValue(resolved);
        mocks.saveRunResults.mockResolvedValue(undefined);

        const finalization = finalizeCompletedPipelineRun(
          "run-finalize-heartbeat",
          "fastq-checksum"
        );
        await discoveryStarted;
        expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(60_000);
        expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledTimes(2);
        const originalToken =
          mocks.db.pipelineRun.updateMany.mock.calls[0]?.[0]?.data?.lastEventAt;
        const renewedToken =
          mocks.db.pipelineRun.updateMany.mock.calls[1]?.[0]?.data?.lastEventAt;
        expect(
          mocks.db.pipelineRun.updateMany.mock.calls[1]?.[0]?.where?.lastEventAt
        ).toBe(originalToken);
        expect(renewedToken).toBeInstanceOf(Date);

        releaseDiscovery(discovered);
        await expect(finalization).resolves.toBe("completed");
        expect(
          mocks.db.pipelineRun.updateMany.mock.calls[2]?.[0]?.where?.lastEventAt
        ).toBe(renewedToken);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not commit completion after a stale finalizer loses its lease", async () => {
      vi.useFakeTimers();
      try {
        const discovered = {
          files: [],
          errors: [],
          summary: {
            assembliesFound: 0,
            binsFound: 0,
            artifactsFound: 0,
            reportsFound: 0,
          },
        };
        let releaseDiscovery!: () => void;
        let markDiscoveryStarted!: () => void;
        const discoveryStarted = new Promise<void>((resolve) => {
          markDiscoveryStarted = resolve;
        });
        const pendingDiscovery = new Promise<typeof discovered>((resolve) => {
          releaseDiscovery = () => resolve(discovered);
        });
        mocks.db.pipelineRun.updateMany
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 });
        mocks.getAdapter.mockReturnValue({
          discoverOutputs: vi.fn().mockImplementation(() => {
            markDiscoveryStarted();
            return pendingDiscovery;
          }),
        });
        mocks.getPackage.mockReturnValue({ manifest: { outputs: [] } });
        mocks.db.pipelineRun.findUnique.mockResolvedValue({
          id: "run-finalize-stale",
          runFolder: "/tmp/run-finalize-stale",
          targetType: "study",
          studyId: "study-1",
          orderId: null,
          inputSampleIds: null,
          config: null,
          study: { samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }] },
          order: null,
        });
        mocks.resolveOutputs.mockResolvedValue({
          success: true,
          assembliesCreated: 0,
          binsCreated: 0,
          artifactsCreated: 0,
          errors: [],
          warnings: [],
        });
        mocks.saveRunResults.mockResolvedValue(undefined);

        const finalization = finalizeCompletedPipelineRun(
          "run-finalize-stale",
          "fastq-checksum"
        );
        await discoveryStarted;
        await vi.advanceTimersByTimeAsync(60_000);
        releaseDiscovery();

        await expect(finalization).resolves.toBe("claim-unavailable");
        expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledTimes(2);
        expect(
          mocks.db.pipelineRun.updateMany.mock.calls.some(
            ([args]) => args?.data?.status === "completed"
          )
        ).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("releases the finalizing claim when output processing fails", async () => {
      const discovered = {
        files: [],
        errors: [],
        summary: {
          assembliesFound: 0,
          binsFound: 0,
          artifactsFound: 0,
          reportsFound: 0,
        },
      };
      const adapter = {
        discoverOutputs: vi.fn().mockResolvedValue(discovered),
      };
      const failedResolution = {
        success: false,
        assembliesCreated: 0,
        binsCreated: 0,
        artifactsCreated: 0,
        errors: ["failed to persist output"],
        warnings: [],
      };

      mocks.db.pipelineRun.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 1 });
      mocks.getAdapter.mockReturnValue(adapter);
      mocks.getPackage.mockReturnValue({ manifest: { outputs: [] } });
      mocks.db.pipelineRun.findUnique.mockResolvedValue({
        id: "run-finalize-failed",
        runFolder: "/tmp/run-finalize-failed",
        targetType: "study",
        studyId: "study-1",
        orderId: null,
        inputSampleIds: null,
        config: null,
        study: { samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }] },
        order: null,
      });
      mocks.resolveOutputs.mockResolvedValue(failedResolution);
      mocks.saveRunResults.mockResolvedValue(undefined);

      await expect(
        finalizeCompletedPipelineRun(
          "run-finalize-failed",
          "fastq-checksum",
          { statusSource: "trace" }
        )
      ).rejects.toThrow("failed to persist output");

      expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledTimes(2);
      expect(mocks.saveRunResults).toHaveBeenCalledWith(
        "run-finalize-failed",
        failedResolution
      );
      const claimedAt =
        mocks.db.pipelineRun.updateMany.mock.calls[0]?.[0]?.data?.lastEventAt;
      expect(claimedAt).toBeInstanceOf(Date);
      expect(mocks.db.pipelineRun.updateMany).toHaveBeenNthCalledWith(2, {
        where: {
          id: "run-finalize-failed",
          status: { in: ["pending", "queued", "running"] },
          statusSource: "finalizing",
          lastEventAt: claimedAt,
        },
        data: {
          status: "running",
          statusSource: "trace",
          currentStep: "Finalizing outputs...",
          progress: 99,
          completedAt: null,
          lastEventAt: expect.any(Date),
        },
      });
      expect(
        mocks.db.pipelineRun.updateMany.mock.calls.some(
          ([args]) => args?.data?.status === "completed"
        )
      ).toBe(false);
    });
  });

  it("extracts exit code from stdout", async () => {
    const runFolder = path.join(tempDir, "run-1");
    const logsDir = path.join(runFolder, "logs");
    await fs.mkdir(logsDir, { recursive: true });
    await fs.writeFile(
      path.join(logsDir, "pipeline.out"),
      "...\nPipeline completed with exit code: 17\n"
    );

    const code = await inferPipelineExitCode(runFolder);
    expect(code).toBe(17);
  });

  it("parses the canonical marker with its trailing timestamp", async () => {
    const runFolder = path.join(tempDir, "run-2");
    const logsDir = path.join(runFolder, "logs");
    await fs.mkdir(logsDir, { recursive: true });
    await fs.writeFile(
      path.join(logsDir, "pipeline.out"),
      "...\nPipeline completed with exit code: 0 at Mon Jun 15 12:00:00 UTC 2026\n"
    );

    const code = await inferPipelineExitCode(runFolder);
    expect(code).toBe(0);
  });

  it("falls back to the canonical marker in stderr", async () => {
    const runFolder = path.join(tempDir, "run-2b");
    const logsDir = path.join(runFolder, "logs");
    await fs.mkdir(logsDir, { recursive: true });
    await fs.writeFile(path.join(logsDir, "pipeline.out"), "running, no marker yet");
    await fs.writeFile(
      path.join(logsDir, "pipeline.err"),
      "Pipeline completed with exit code: 9 at Mon Jun 15 12:00:00 UTC 2026"
    );

    const code = await inferPipelineExitCode(runFolder);
    expect(code).toBe(9);
  });

  it("ignores mid-run exit-code chatter without the canonical marker", async () => {
    // Regression: the monitor used to scrape any "exit code: N" / "exited with
    // code N" substring, so live Nextflow/conda output finalized a still-running
    // run as completed (metaxpath marked completed while building its conda env).
    const runFolder = path.join(tempDir, "run-2c");
    const logsDir = path.join(runFolder, "logs");
    await fs.mkdir(logsDir, { recursive: true });
    await fs.writeFile(
      path.join(logsDir, "pipeline.out"),
      [
        "executor >  local",
        "[a1/b2c3d4] process > MV_FASTQ (2 of 5) [ 40%] 2 of 5",
        "Creating env using conda: /net/broker/conda/metax.env.yaml",
        "some tool reported exit code: 0 while solving",
      ].join("\n")
    );
    await fs.writeFile(
      path.join(logsDir, "pipeline.err"),
      "Caused by: process terminated; a helper exited with code 9"
    );

    const code = await inferPipelineExitCode(runFolder);
    expect(code).toBeNull();
  });

  it("returns null when no exit code can be inferred", async () => {
    const runFolder = path.join(tempDir, "run-3");
    await fs.mkdir(path.join(runFolder, "logs"), { recursive: true });
    await fs.writeFile(path.join(runFolder, "logs", "pipeline.out"), "hello");
    await fs.writeFile(path.join(runFolder, "logs", "pipeline.err"), "world");

    const code = await inferPipelineExitCode(runFolder);
    expect(code).toBeNull();
  });
});
