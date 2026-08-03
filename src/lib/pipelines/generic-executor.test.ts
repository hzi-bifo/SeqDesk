import { execFileSync } from "node:child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineAdapter } from "./adapters/types";

const mocks = vi.hoisted(() => ({
  db: {
    pipelineRun: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
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
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("./package-loader", () => ({
  getPackage: mocks.packageLoader.getPackage,
}));

vi.mock("./adapters/types", () => ({
  getAdapter: mocks.adapters.getAdapter,
  registerAdapter: mocks.adapters.registerAdapter,
}));

vi.mock("./generic-adapter", () => ({
  createGenericAdapter: mocks.genericAdapter.createGenericAdapter,
}));

import { prepareGenericRun, mergeProfiles } from "./generic-executor";

function createAdapter(overrides?: Partial<PipelineAdapter>): PipelineAdapter {
  return {
    pipelineId: "mag",
    validateInputs: vi.fn().mockResolvedValue({ valid: true, issues: [] }),
    generateSamplesheet: vi
      .fn()
      .mockResolvedValue({ content: "sample_id\nSAMPLE-1", sampleCount: 1, errors: [] }),
    discoverOutputs: vi
      .fn()
      .mockResolvedValue({
        files: [],
        errors: [],
        summary: {
          assembliesFound: 0,
          binsFound: 0,
          artifactsFound: 0,
          reportsFound: 0,
        },
      }),
    ...(overrides || {}),
  };
}

function baseExecutionSettings(pipelineRunDir: string) {
  return {
    useSlurm: false,
    slurmQueue: "cpu",
    slurmCores: 4,
    slurmMemory: "8GB",
    slurmTimeLimit: 2,
    pipelineRunDir,
    dataBasePath: pipelineRunDir,
    nextflowProfile: "conda",
    runtimeMode: "conda" as const,
    condaEnv: "seqdesk-test",
  };
}

describe("generic-executor", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-generic-executor-"));
    vi.clearAllMocks();
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);
    mocks.db.pipelineRun.update.mockResolvedValue({});
    mocks.db.pipelineRun.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns error when pipeline package cannot be found", async () => {
    mocks.packageLoader.getPackage.mockReturnValue(undefined);

    const result = await prepareGenericRun({
      runId: "run-1",
      pipelineId: "missing-pipe",
      target: { type: "study", studyId: "study-1", sampleIds: ["sample-1"] },
      config: {},
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(result).toEqual({
      success: false,
      runId: "run-1",
      errors: ["Pipeline package not found: missing-pipe"],
    });
  });

  it("returns error when a local pipeline target does not exist", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(undefined);
    mocks.genericAdapter.createGenericAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "./missing.nf",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: path.join(tempDir, "pipelines"),
    } as never);

    const accessSpy = vi.spyOn(fs, "access").mockRejectedValue(new Error("not found"));

    const result = await prepareGenericRun({
      runId: "run-1",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["sample-1"] },
      config: {},
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual([
      `Local pipeline path not found: ${path.join(tempDir, "pipelines", "missing.nf")}`,
    ]);
    expect(accessSpy).toHaveBeenCalledWith(path.join(tempDir, "pipelines", "missing.nf"));
    expect(adapter.generateSamplesheet).not.toHaveBeenCalled();
    expect(mocks.db.pipelineRun.updateMany).not.toHaveBeenCalled();
  });

  it('treats "." as the installed package directory instead of a remote pipeline name', async () => {
    const adapter = createAdapter();
    const packageRoot = path.join(tempDir, "package-root");
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, "main.nf"), "workflow {}\n");

    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: ".",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
          paramMap: {},
        },
      },
      basePath: packageRoot,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-package-root",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["sample-1"] },
      config: {},
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    const script = await fs.readFile(path.join(result.runFolder!, "run.sh"), "utf8");
    expect(script).toContain(`run ${packageRoot} \\`);
  });

  it("returns validation errors when samplesheet generation has no valid samples", async () => {
    const adapter = createAdapter({
      generateSamplesheet: vi
        .fn()
        .mockResolvedValue({ content: "", sampleCount: 0, errors: ["No samples selected"] }),
    });
    mocks.adapters.getAdapter.mockReturnValue(undefined);
    mocks.genericAdapter.createGenericAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-1",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1" },
      config: {},
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("No valid samples for samplesheet");
    expect(result.errors).toContain("No samples selected");
    expect(adapter.generateSamplesheet).toHaveBeenCalled();
    expect(mocks.db.pipelineRun.updateMany).not.toHaveBeenCalled();
  });

  it("fails when samplesheet generation skips any selected sample", async () => {
    const adapter = createAdapter({
      generateSamplesheet: vi.fn().mockResolvedValue({
        content: "sample_id\nSAMPLE-1",
        sampleCount: 1,
        errors: ["Sample SAMPLE-2: no paired reads"],
      }),
    });
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-partial",
      pipelineId: "mag",
      target: {
        type: "study",
        studyId: "study-1",
        sampleIds: ["sample-1", "sample-2"],
      },
      config: {},
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("Sample SAMPLE-2: no paired reads");
    expect(mocks.db.pipelineRun.updateMany).not.toHaveBeenCalled();
    expect(await fs.readdir(tempDir)).toEqual([]);
  });

  it("does not resurrect a run cancelled while generic preparation is writing its folder", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);
    mocks.db.pipelineRun.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await prepareGenericRun({
      runId: "run-cancelled",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["sample-1"] },
      config: {},
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("Run was cancelled or finalized during preparation");
    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "run-cancelled",
          status: "queued",
          OR: expect.arrayContaining([
            { statusSource: null },
            {
              statusSource: {
                notIn: ["finalizing", "cancelling"],
              },
            },
          ]),
        }),
      })
    );
    const remainingPreparedFolders = (await fs.readdir(tempDir)).filter((entry) =>
      entry.startsWith("MAG-")
    );
    expect(remainingPreparedFolders).toEqual([]);
  });

  it("isolates concurrent preparations that calculate the same run number", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);

    // Both preparations observe the same empty allocation set. In production
    // one database update then wins the unique runNumber constraint, but their
    // files must already be isolated before that claim is attempted.
    const [first, second] = await Promise.all([
      prepareGenericRun({
        runId: "run-concurrent-a",
        pipelineId: "mag",
        target: { type: "study", studyId: "study-1", sampleIds: ["sample-1"] },
        config: {},
        executionSettings: baseExecutionSettings(tempDir),
        userId: "user-1",
      }),
      prepareGenericRun({
        runId: "run-concurrent-b",
        pipelineId: "mag",
        target: { type: "study", studyId: "study-1", sampleIds: ["sample-1"] },
        config: {},
        executionSettings: baseExecutionSettings(tempDir),
        userId: "user-1",
      }),
    ]);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.runFolder).not.toBe(second.runFolder);
    const preparedCalls = mocks.db.pipelineRun.updateMany.mock.calls;
    expect(preparedCalls[0][0].data.runNumber).toBe(
      preparedCalls[1][0].data.runNumber
    );
    expect(await fs.readFile(path.join(first.runFolder!, "run.sh"), "utf8")).toContain(
      first.runFolder
    );
    expect(await fs.readFile(path.join(second.runFolder!, "run.sh"), "utf8")).toContain(
      second.runFolder
    );
  });

  it("prepares a local run script using existing adapter and writes runtime artifacts", async () => {
    const adapter = createAdapter({
      generateSamplesheet: vi.fn().mockResolvedValue({
        content: "sample_id\nSAMPLE-1\nSAMPLE-2",
        sampleCount: 2,
        errors: [],
      }),
    });
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {
            project: "demo",
          },
          paramMap: {
            threads: "--threads",
            runType: "",
          },
          paramRules: [
            {
              when: { runType: "full" },
              add: ["--full-mode", { flag: "--limit", value: 10 }],
            },
          ],
        },
      },
      samplesheet: {
        samplesheet: {
          format: "tsv",
          filename: "inputs/pipeline-samples.tsv",
          rows: { scope: "sample" },
          columns: [],
        },
      },
      basePath: tempDir,
    } as never);
    mocks.db.pipelineRun.findMany.mockResolvedValue([{ runNumber: "MAG-20260303-007" }]);

    const result = await prepareGenericRun({
      runId: "run-1",
      pipelineId: "mag",
      target: { type: "order", orderId: "order-1", sampleIds: ["sample-1", "sample-2"] },
      config: {
        threads: 8,
        runType: "full",
        customValue: "abc",
        verbose: true,
        blank: "   ",
        falseValue: false,
        _internal: "ignore",
      },
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.runFolder).toContain(tempDir);
    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledTimes(1);
    const updateCall = mocks.db.pipelineRun.updateMany.mock.calls[0][0];
    expect(updateCall.data.runNumber).toMatch(/^MAG-\d{8}-008$/);
    expect(result.runFolder).toContain(updateCall.data.runNumber);
    expect(mocks.genericAdapter.createGenericAdapter).not.toHaveBeenCalled();

    const script = await fs.readFile(path.join(result.runFolder!, "run.sh"), "utf8");
    expect(script).toContain("--threads 8");
    expect(script).toContain("--project demo");
    expect(script).toContain("--customValue abc");
    expect(script).toContain("--verbose");
    expect(script).not.toContain("--runType");
    expect(script).not.toContain("--blank");
    expect(script).toContain("--falseValue false");
    expect(script).toContain("--full-mode");
    expect(script).toContain("--limit 10");

    const nextflowConfig = await fs.readFile(path.join(result.runFolder!, "nextflow.config"), "utf8");
    expect(nextflowConfig).toContain("standard {}");
    expect(nextflowConfig).toContain("conda {");
    expect(nextflowConfig).toContain("conda.enabled = true");
    expect(nextflowConfig).toContain("useMamba = false");
    expect(nextflowConfig).not.toContain("executor = 'slurm'");
    expect(script).not.toContain("#SBATCH");

    const descriptorSamplesheetPath = path.join(
      result.runFolder!,
      "inputs",
      "pipeline-samples.tsv"
    );
    const samplesheet = await fs.readFile(descriptorSamplesheetPath, "utf8");
    expect(samplesheet).toBe("sample_id\nSAMPLE-1\nSAMPLE-2");
    expect(script).toContain(`--input ${descriptorSamplesheetPath}`);
    expect(adapter.generateSamplesheet).toHaveBeenCalledWith(expect.objectContaining({
      target: { type: "order", orderId: "order-1", sampleIds: ["sample-1", "sample-2"] },
      dataBasePath: tempDir,
      config: expect.objectContaining({
        threads: 8,
        customValue: "abc",
        verbose: true,
      }),
    }));

    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "run-1",
        status: "queued",
        OR: expect.arrayContaining([
          { statusSource: null },
          {
            statusSource: {
              notIn: ["finalizing", "cancelling"],
            },
          },
        ]),
      }),
      data: expect.objectContaining({
        runNumber: expect.stringMatching(/^MAG-\d{8}-008$/),
        runFolder: result.runFolder,
      }),
    });
  });

  it("emits conda.cacheDir in nextflow.config when condaCacheDir is set", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: { type: "nextflow", pipeline: "nf-core/mag", version: "2.0.0", profiles: ["conda"], defaultParams: {} },
      },
      basePath: tempDir,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-cache",
      pipelineId: "mag",
      target: { type: "order", orderId: "order-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: {
        ...baseExecutionSettings(tempDir),
        condaCacheDir: "/net/shared/conda-cache",
      },
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    const config = await fs.readFile(path.join(result.runFolder!, "nextflow.config"), "utf8");
    expect(config).toContain("cacheDir = '/net/shared/conda-cache'");
    // Re-run safety: nextflow ABORTS if report/timeline/trace/dag already exist in a reused
    // run folder; the generated config must enable overwrite so a resubmit/retry doesn't crash.
    expect(config).toContain("report.overwrite = true");
    expect(config).toContain("timeline.overwrite = true");
    expect(config).toContain("trace.fields = '");
    expect(config).toContain("process,tag,name,status,exit,attempt,");

    // And NOT emitted when unset.
    const result2 = await prepareGenericRun({
      runId: "run-nocache",
      pipelineId: "mag",
      target: { type: "order", orderId: "order-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });
    const config2 = await fs.readFile(path.join(result2.runFolder!, "nextflow.config"), "utf8");
    expect(config2).not.toContain("cacheDir");
  });

  it("passes MetaxPath params files using Nextflow -params-file", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "metaxpath",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
          paramMap: {
            paramsFile: "-params-file",
          },
        },
      },
      basePath: tempDir,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-metaxpath",
      pipelineId: "metaxpath",
      target: { type: "order", orderId: "order-1", sampleIds: ["sample-1"] },
      config: {
        paramsFile: "/shared/metaxpath/params.yaml",
      },
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    const script = await fs.readFile(path.join(result.runFolder!, "run.sh"), "utf8");
    expect(script).toContain("-params-file /shared/metaxpath/params.yaml");
    expect(script).not.toContain("--paramsFile");
  });

  it("passes params files before explicit mapped params so run config overrides file defaults", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "metaxpath",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
          paramMap: {
            kraken2MemoryMapping: "--kraken2_memory_mapping",
            paramsFile: "-params-file",
          },
        },
      },
      basePath: tempDir,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-metaxpath-order",
      pipelineId: "metaxpath",
      target: { type: "order", orderId: "order-1", sampleIds: ["sample-1"] },
      config: {
        paramsFile: "/shared/metaxpath/params.yaml",
        kraken2MemoryMapping: true,
      },
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    const script = await fs.readFile(path.join(result.runFolder!, "run.sh"), "utf8");
    expect(script.indexOf("-params-file /shared/metaxpath/params.yaml")).toBeGreaterThan(-1);
    expect(script.indexOf("--kraken2_memory_mapping")).toBeGreaterThan(-1);
    expect(script.indexOf("-params-file /shared/metaxpath/params.yaml")).toBeLessThan(
      script.indexOf("--kraken2_memory_mapping")
    );
  });

  it("maps single-dash Nextflow switches as presence-only booleans", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "3.0.0",
          profiles: ["conda"],
          defaultParams: {},
          paramMap: {
            stubMode: "-stub",
            skipQuast: "--skip_quast",
          },
        },
      },
      basePath: tempDir,
    } as never);

    const enabled = await prepareGenericRun({
      runId: "run-single-dash-enabled",
      pipelineId: "mag",
      target: { type: "order", orderId: "order-1", sampleIds: ["sample-1"] },
      config: {
        stubMode: true,
        skipQuast: false,
      },
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(enabled.success).toBe(true);
    const enabledScript = await fs.readFile(path.join(enabled.runFolder!, "run.sh"), "utf8");
    expect(enabledScript).toContain("-stub");
    expect(enabledScript).toContain("--skip_quast false");

    const disabled = await prepareGenericRun({
      runId: "run-single-dash-disabled",
      pipelineId: "mag",
      target: { type: "order", orderId: "order-1", sampleIds: ["sample-1"] },
      config: {
        stubMode: false,
      },
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(disabled.success).toBe(true);
    const disabledScript = await fs.readFile(path.join(disabled.runFolder!, "run.sh"), "utf8");
    expect(disabledScript).not.toContain("-stub false");
    expect(disabledScript).not.toContain("-stub");
  });

  it("caps MetaxPath local thread defaults to available local CPUs", async () => {
    vi.spyOn(os, "availableParallelism").mockReturnValue(4);
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "metaxpath",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {
            threads: 20,
            topn: 50,
          },
          paramMap: {
            threads: "--threads",
            topn: "--topn",
          },
        },
      },
      basePath: tempDir,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-metaxpath-local",
      pipelineId: "metaxpath",
      target: { type: "study", studyId: "study-1", sampleIds: ["sample-1"] },
      config: {},
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    const script = await fs.readFile(path.join(result.runFolder!, "run.sh"), "utf8");
    expect(script).toContain("--threads 4");
    expect(script).not.toContain("--threads 20");
    expect(script).toContain("--topn 50");
  });

  it("does not cap MetaxPath thread defaults for SLURM runs", async () => {
    vi.spyOn(os, "availableParallelism").mockReturnValue(4);
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "metaxpath",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {
            threads: 20,
          },
          paramMap: {
            threads: "--threads",
          },
        },
      },
      basePath: tempDir,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-metaxpath-slurm",
      pipelineId: "metaxpath",
      target: { type: "study", studyId: "study-1", sampleIds: ["sample-1"] },
      config: {},
      executionSettings: {
        ...baseExecutionSettings(tempDir),
        useSlurm: true,
      },
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    const script = await fs.readFile(path.join(result.runFolder!, "run.sh"), "utf8");
    expect(script).toContain("--threads 20");
  });

  it("normalizes relative pipeline run directories to absolute paths", async () => {
    const adapter = createAdapter();
    const relativeRunDir = path.relative(process.cwd(), tempDir) || ".";

    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-2",
      pipelineId: "simulate-reads",
      target: { type: "order", orderId: "order-1", sampleIds: ["sample-1"] },
      config: {},
      executionSettings: baseExecutionSettings(relativeRunDir),
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    expect(result.runFolder).toBe(
      path.join(await fs.realpath(relativeRunDir), path.basename(result.runFolder!))
    );
    expect(await fs.realpath(result.runFolder!)).toBe(result.runFolder);
    expect(path.isAbsolute(result.runFolder!)).toBe(true);

    const script = await fs.readFile(path.join(result.runFolder!, "run.sh"), "utf8");
    expect(script).toContain(`STDOUT_LOG="${result.runFolder}/logs/pipeline.out"`);
    expect(script).toContain(`STDERR_LOG="${result.runFolder}/logs/pipeline.err"`);
  });

  it("persists the canonical run folder when the configured root is a symlink", async () => {
    const adapter = createAdapter();
    const physicalRunRoot = path.join(tempDir, "physical-runs");
    const configuredRunRoot = path.join(tempDir, "configured-runs");
    await fs.mkdir(physicalRunRoot);
    await fs.symlink(physicalRunRoot, configuredRunRoot, "dir");

    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-symlink",
      pipelineId: "simulate-reads",
      target: { type: "order", orderId: "order-1", sampleIds: ["sample-1"] },
      config: {},
      executionSettings: baseExecutionSettings(configuredRunRoot),
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    expect(path.dirname(result.runFolder!)).toBe(
      await fs.realpath(physicalRunRoot)
    );
    expect(await fs.realpath(result.runFolder!)).toBe(result.runFolder);
    const persistedRunFolder = mocks.db.pipelineRun.updateMany.mock.calls.find(
      (call) => call[0]?.data?.runFolder
    )?.[0].data.runFolder;
    expect(persistedRunFolder).toBe(result.runFolder);
    const script = await fs.readFile(
      path.join(result.runFolder!, "run.sh"),
      "utf8"
    );
    expect(script).toContain(result.runFolder!);
    expect(script).not.toContain(configuredRunRoot);
  });

  it("generates a SLURM script when useSlurm is enabled", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "2.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-slurm",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: {
        ...baseExecutionSettings(tempDir),
        useSlurm: true,
        slurmQueue: "gpu",
        slurmCores: 16,
        slurmMemory: "128GB",
        slurmTimeLimit: 24,
        slurmOptions: "--gres=gpu:1",
      },
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    const script = await fs.readFile(path.join(result.runFolder!, "run.sh"), "utf8");
    expect(script).toContain("#SBATCH --job-name=seqdesk-run-slurm");
    expect(script).toContain("#SBATCH -p gpu");
    expect(script).toContain("#SBATCH -c 16");
    expect(script).toContain("#SBATCH --mem='128GB'");
    expect(script).toContain("#SBATCH -t 24:0:0");
    expect(script).toContain("#SBATCH --gres=gpu:1");
    expect(script).toContain("nf-core/mag");
    expect(script).toContain("-r 2.0.0");
    expect(script).toContain("SEQDESK_PIPELINE_RUN_ID='run-slurm'");
    expect(script).toContain(
      'SLURM_ATTESTATION_FILE="$RUN_FOLDER/logs/slurm-$SLURM_JOB_ID.attestation"',
    );
    expect(script).toContain("slurm_job_id=%s");
    expect(script).toContain("phase=completed");
    const finalizer = script.slice(
      script.indexOf("finalize_seqdesk_slurm_wrapper()"),
      script.indexOf("trap finalize_seqdesk_slurm_wrapper EXIT"),
    );
    expect(finalizer).toContain(
      "elif ! write_seqdesk_slurm_completion_attestation; then",
    );
    expect(
      finalizer.indexOf('cp -f "/tmp/seqdesk-slurm-$SLURM_JOB_ID.err"'),
    ).toBeLessThan(
      finalizer.indexOf(
        "elif ! write_seqdesk_slurm_completion_attestation; then",
      ),
    );
    expect(
      script.slice(script.indexOf('"${NEXTFLOW_RUNNER[@]}" run')),
    ).not.toContain("write_seqdesk_slurm_completion_attestation");
    expect(() => execFileSync("bash", ["-n"], { input: script })).not.toThrow();

    const config = await fs.readFile(path.join(result.runFolder!, "nextflow.config"), "utf8");
    expect(config).toContain("executor = 'slurm'");
    expect(config).toContain("cpus = 16");
    expect(config).toContain("memory = '128GB'");
    expect(config).toContain("time = '24h'");
    expect(config).toContain("queue = 'gpu'");
    expect(config).toContain("clusterOptions = '--gres=gpu:1'");
  });

  it("shell-quotes admin-supplied conda settings so they cannot break out of the script", async () => {
    // Regression guard for command injection via execution settings: condaEnv and
    // condaPath are free-form admin/config values interpolated into run.sh, so a
    // value containing shell metacharacters must be single-quoted, not emitted as
    // a bare double-quoted assignment that could run an injected command.
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "2.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-inject",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: {
        ...baseExecutionSettings(tempDir),
        condaEnv: 'evil"; touch hacked; #',
        condaPath: "/opt/c$(whoami)",
      },
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    const script = await fs.readFile(path.join(result.runFolder!, "run.sh"), "utf8");
    // Single-quoted (neutralized), never the broken-out bare form.
    expect(script).toContain(`CONDA_ENV='evil"; touch hacked; #'`);
    expect(script).toContain("CONDA_BASE='/opt/c$(whoami)'");
    expect(script).not.toContain('CONDA_ENV="evil"');
    expect(script).not.toContain('touch hacked; #"');
  });

  it("refuses to launch when the run directory contains shell-unsafe characters", async () => {
    // Regression guard: pipelineRunDir can also come from a config file/env (not
    // just the validated settings route), so the run folder is checked at launch.
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "2.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);

    const unsafeRunDir = path.join(tempDir, "ev$(touch pwn)il");
    const result = await prepareGenericRun({
      runId: "run-unsafe",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: baseExecutionSettings(unsafeRunDir),
      userId: "user-1",
    });

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => /unsafe characters/i.test(e))).toBe(true);
  });

  it("runs the pipeline as a single SLURM job (local executor inside) when SEQDESK_SLURM_INLINE_EXECUTOR is set", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "2.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);

    process.env.SEQDESK_SLURM_INLINE_EXECUTOR = "1";
    try {
      const result = await prepareGenericRun({
        runId: "run-slurm-inline",
        pipelineId: "mag",
        target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
        config: {},
        executionSettings: {
          ...baseExecutionSettings(tempDir),
          useSlurm: true,
          slurmQueue: "cpu",
          slurmCores: 1,
          slurmMemory: "1G",
          slurmTimeLimit: 10,
        },
        userId: "user-1",
      });

      expect(result.success).toBe(true);
      // Still a single SLURM job (sbatch wrapper), but Nextflow does NOT submit a job
      // per process — no executor='slurm' block, so it uses the local executor inside.
      const script = await fs.readFile(path.join(result.runFolder!, "run.sh"), "utf8");
      expect(script).toContain("#SBATCH -p cpu");
      const config = await fs.readFile(path.join(result.runFolder!, "nextflow.config"), "utf8");
      expect(config).not.toContain("executor = 'slurm'");
    } finally {
      delete process.env.SEQDESK_SLURM_INLINE_EXECUTOR;
    }
  });

  it("includes MAG CONCOCT workaround in nextflow config for mag pipeline", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
        package: { id: "mag" },
      },
      basePath: tempDir,
      id: "mag",
    } as never);

    const result = await prepareGenericRun({
      runId: "run-mag",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    const config = await fs.readFile(path.join(result.runFolder!, "nextflow.config"), "utf8");
    expect(config).toContain("CONCOCT");
    expect(config).toContain("concoct=1.1.0");
  });

  it("includes weblog config when weblogUrl is provided", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-weblog",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: {
        ...baseExecutionSettings(tempDir),
        weblogUrl: "http://localhost:3000/api/pipelines/weblog",
        weblogSecret: "mysecret",
      },
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    const config = await fs.readFile(path.join(result.runFolder!, "nextflow.config"), "utf8");
    expect(config).toContain("weblog {");
    expect(config).toContain("enabled = true");
    expect(config).toContain("runId=run-weblog");
    expect(config).toContain("token=mysecret");
  });

  it("returns error when adapter cannot be created", async () => {
    mocks.adapters.getAdapter.mockReturnValue(undefined);
    mocks.genericAdapter.createGenericAdapter.mockReturnValue(null);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-no-adapter",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("Could not create adapter for pipeline: mag");
  });

  it("handles unexpected errors gracefully", async () => {
    mocks.packageLoader.getPackage.mockImplementation(() => {
      throw new Error("Unexpected crash");
    });

    const result = await prepareGenericRun({
      runId: "run-crash",
      pipelineId: "crash-pipe",
      target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("Failed to prepare run: Unexpected crash");
  });

  it("shell-escapes flag values containing metacharacters so they cannot inject commands", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
          paramMap: {
            templateDir: "--template-dir",
          },
        },
      },
      basePath: tempDir,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-inject",
      pipelineId: "mag",
      target: { type: "order", orderId: "order-1", sampleIds: ["s1"] },
      config: {
        templateDir: "foo; rm -rf /",
        "bad;key": "x",
      },
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    const script = await fs.readFile(path.join(result.runFolder!, "run.sh"), "utf8");
    expect(script).toContain("--template-dir 'foo; rm -rf /'");
    expect(script).not.toContain("--template-dir foo; rm -rf /");
    expect(script).not.toContain("--bad;key");
  });

  it("shell-escapes generated Nextflow paths and local pipeline targets", async () => {
    const adapter = createAdapter();
    const runRoot = path.join(tempDir, "run root with spaces");
    const packageRoot = path.join(tempDir, "package root with spaces");
    const workflowPath = path.join(packageRoot, "workflow", "main.nf");
    await fs.mkdir(path.dirname(workflowPath), { recursive: true });
    await fs.writeFile(workflowPath, "workflow {}\n");

    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "./workflow/main.nf",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
          paramMap: {},
        },
      },
      basePath: packageRoot,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-paths",
      pipelineId: "mag",
      target: { type: "order", orderId: "order-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: baseExecutionSettings(runRoot),
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    const script = await fs.readFile(path.join(result.runFolder!, "run.sh"), "utf8");
    expect(script).toContain(`run '${workflowPath}' \\`);
    expect(script).toContain(`--input '${path.join(result.runFolder!, "samplesheet.csv")}'`);
    expect(script).toContain(`--outdir '${path.join(result.runFolder!, "output")}'`);
    expect(script).toContain(`-with-trace '${path.join(result.runFolder!, "trace.txt")}'`);
    expect(script).toContain(`-c '${path.join(result.runFolder!, "nextflow.config")}'`);
  });

  it("generates conda activation bootstrap when condaPath is set", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-conda",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: {
        ...baseExecutionSettings(tempDir),
        condaPath: "/opt/miniconda3",
        condaEnv: "my-env",
      },
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    const script = await fs.readFile(path.join(result.runFolder!, "run.sh"), "utf8");
    // These values are now passed through shellQuote; safe values render bare.
    expect(script).toContain("CONDA_BASE=/opt/miniconda3");
    expect(script).toContain("CONDA_ENV=my-env");
    expect(script).toContain("CONDA_ENV_SELECTOR=-n");
    expect(script).toContain("source \"$CONDA_SH\"");
    expect(script).toContain("conda activate");
  });

  it("uses conda run -p for a configured shared environment prefix", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-conda-prefix",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: {
        ...baseExecutionSettings(tempDir),
        condaPath: "/opt/miniconda3",
        condaEnv: "/shared/conda/envs/seqdesk",
      },
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    const script = await fs.readFile(
      path.join(result.runFolder!, "run.sh"),
      "utf8"
    );
    expect(script).toContain("CONDA_ENV=/shared/conda/envs/seqdesk");
    expect(script).toContain("CONDA_ENV_SELECTOR=-p");
    expect(script).toContain(
      'NEXTFLOW_RUNNER=(conda run "$CONDA_ENV_SELECTOR" "$CONDA_ENV" nextflow)'
    );
  });

  it("records the exit code via an EXIT trap so failures still write the marker", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);

    const localResult = await prepareGenericRun({
      runId: "run-trap-local",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(localResult.success).toBe(true);
    const localScript = await fs.readFile(path.join(localResult.runFolder!, "run.sh"), "utf8");
    // The marker must be written from a trap so "set -e" cannot skip it on failure.
    expect(localScript).toContain(
      `trap 'EXIT_CODE=$?; echo "Pipeline completed with exit code: $EXIT_CODE at $(date)" >> "$STDOUT_LOG"; exit $EXIT_CODE' EXIT`
    );
    // The dead post-command capture must be gone.
    expect(localScript).not.toContain("EXIT_CODE=$?\necho");

    const slurmResult = await prepareGenericRun({
      runId: "run-trap-slurm",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: { ...baseExecutionSettings(tempDir), useSlurm: true },
      userId: "user-1",
    });

    expect(slurmResult.success).toBe(true);
    const slurmScript = await fs.readFile(path.join(slurmResult.runFolder!, "run.sh"), "utf8");
    expect(slurmScript).toContain(
      "trap finalize_seqdesk_slurm_wrapper EXIT"
    );
    expect(slurmScript).toContain("SEQDESK_WRAPPER_EXIT_CODE=$?");
    expect(slurmScript).toContain(
      "Failed to persist SLURM capture logs; refusing success attestation"
    );
    expect(slurmScript.indexOf("trap finalize_seqdesk_slurm_wrapper EXIT")).toBeLessThan(
      slurmScript.indexOf('for _ in $(seq 1 15)')
    );
    expect(slurmScript).not.toContain("EXIT_CODE=$?\necho");
    expect(slurmScript).not.toContain("trap '");
    // SLURM's own logs go to node-local /tmp (root-squash safe) and are copied back.
    expect(slurmScript).toContain('#SBATCH --output="/tmp/seqdesk-slurm-%j.out"');
    expect(slurmScript).toContain('mkdir -p "');
  });

  it("does not emit --input/--outdir twice when config also resolves them", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
          paramMap: {
            inputDir: "--input",
          },
        },
      },
      basePath: tempDir,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-dup-flags",
      pipelineId: "mag",
      target: { type: "order", orderId: "order-1", sampleIds: ["s1"] },
      config: {
        inputDir: "/some/other/input",
        outdir: "/some/other/output",
      },
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    const script = await fs.readFile(path.join(result.runFolder!, "run.sh"), "utf8");

    // The SeqDesk-managed samplesheet/output paths win; the config-derived
    // --input/--outdir must be dropped so the flags are not duplicated.
    expect(script.match(/--input /g) || []).toHaveLength(1);
    expect(script.match(/--outdir /g) || []).toHaveLength(1);
    expect(script).toContain(`--input ${path.join(result.runFolder!, "samplesheet.csv")}`);
    expect(script).toContain(`--outdir ${path.join(result.runFolder!, "output")}`);
    expect(script).not.toContain("/some/other/input");
    expect(script).not.toContain("/some/other/output");
  });

  it("retries run-number allocation when a concurrent run claims the number first", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);

    // First findMany returns the same max for both racers; after the first
    // claim succeeds, the next findMany reflects it so the retry computes 009.
    mocks.db.pipelineRun.findMany
      .mockResolvedValueOnce([{ runNumber: "MAG-20260303-007" }])
      .mockResolvedValueOnce([{ runNumber: "MAG-20260303-008" }]);

    const conflict = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["runNumber"] },
    });
    mocks.db.pipelineRun.updateMany
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ count: 1 });

    const result = await prepareGenericRun({
      runId: "run-race",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledTimes(2);
    const finalCall = mocks.db.pipelineRun.updateMany.mock.calls[1][0];
    expect(finalCall.data.runNumber).toMatch(/^MAG-\d{8}-009$/);
    expect(result.runFolder).toContain(finalCall.data.runNumber);
  });

  it("surfaces non-runNumber unique violations instead of retrying", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);

    const conflict = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["someOtherField"] },
    });
    mocks.db.pipelineRun.updateMany.mockRejectedValue(conflict);

    const result = await prepareGenericRun({
      runId: "run-other-conflict",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("Failed to prepare run");
    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(tempDir)).toEqual([]);
  });

  it("removes the final folder when run-number collision retries are exhausted", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);
    const conflict = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["runNumber"] },
    });
    mocks.db.pipelineRun.updateMany.mockRejectedValue(conflict);

    const result = await prepareGenericRun({
      runId: "run-exhausted",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(result.success).toBe(false);
    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledTimes(5);
    expect(await fs.readdir(tempDir)).toEqual([]);
  });

  it("keeps incrementing run numbers past 999 instead of stalling", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);
    mocks.db.pipelineRun.findMany.mockResolvedValue([{ runNumber: "MAG-20260303-999" }]);

    const result = await prepareGenericRun({
      runId: "run-1000",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    const updateCall = mocks.db.pipelineRun.updateMany.mock.calls[0][0];
    expect(updateCall.data.runNumber).toMatch(/^MAG-\d{8}-1000$/);
  });

  it("rejects malformed SLURM header values instead of injecting them", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-slurm-inject",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: {
        ...baseExecutionSettings(tempDir),
        useSlurm: true,
        slurmQueue: "evil queue; rm -rf /",
        slurmMemory: "64GB'; rm -rf /; echo '",
        slurmOptions: "--gres=gpu:1\nmalicious line",
      },
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    const script = await fs.readFile(path.join(result.runFolder!, "run.sh"), "utf8");
    // Malformed queue/memory fall back to safe defaults.
    expect(script).toContain("#SBATCH -p cpu");
    expect(script).toContain("#SBATCH --mem='64GB'");
    expect(script).not.toContain("rm -rf /");
    // slurmOptions with an embedded newline is dropped entirely.
    expect(script).not.toContain("malicious line");
  });

  it("shell-quotes well-formed multi-token slurmOptions", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-slurm-opts",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: {
        ...baseExecutionSettings(tempDir),
        useSlurm: true,
        slurmOptions: "--gres=gpu:1 --constraint=intel",
      },
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    const script = await fs.readFile(path.join(result.runFolder!, "run.sh"), "utf8");
    expect(script).toContain("#SBATCH --gres=gpu:1 --constraint=intel");
    expect(script).toContain(`#SBATCH -D "${result.runFolder}"`);

    const blocked = await prepareGenericRun({
      runId: "run-slurm-owned-path",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: {
        ...baseExecutionSettings(tempDir),
        useSlurm: true,
        slurmOptions: "--output=/tmp/hijacked.out --exclusive",
      },
      userId: "user-1",
    });
    expect(blocked.success).toBe(false);
    expect(blocked.errors.join("\n")).toMatch(
      /overrides SeqDesk-owned WorkDir or capture-log paths/,
    );
  });

  it("does not let admin SLURM options override the SeqDesk cleanup job name", async () => {
    const adapter = createAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      basePath: tempDir,
    } as never);

    const result = await prepareGenericRun({
      runId: "run-slurm-name",
      pipelineId: "mag",
      target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
      config: {},
      executionSettings: {
        ...baseExecutionSettings(tempDir),
        useSlurm: true,
        slurmOptions:
          "--job-name=admin-name -J another-name --gres=gpu:1",
      },
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    const script = await fs.readFile(
      path.join(result.runFolder!, "run.sh"),
      "utf8"
    );
    expect(script.match(/^#SBATCH --job-name=/gm)).toHaveLength(1);
    expect(script).toContain("#SBATCH --job-name=seqdesk-run-slurm-name");
    expect(script).not.toContain("#SBATCH --job-name=admin-name");
    expect(script).not.toContain("-J another-name");
    expect(script).toContain("#SBATCH --gres=gpu:1");
  });

  it("stages declared same-study artifacts and injects the protected input directory", async () => {
    const adapter = createAdapter();
    const packageRoot = path.join(tempDir, "multiqc-package");
    const workflowDir = path.join(packageRoot, "workflow");
    const priorRunFolder = path.join(tempDir, "prior-fastqc-run");
    const priorArtifact = path.join(
      priorRunFolder,
      "output",
      "fastqc_reports",
      "SAMPLE-1_fastqc.zip"
    );
    await fs.mkdir(workflowDir, { recursive: true });
    await fs.mkdir(path.dirname(priorArtifact), { recursive: true });
    await fs.writeFile(path.join(workflowDir, "main.nf"), "workflow {}\n");
    await fs.writeFile(priorArtifact, "fastqc archive bytes");

    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.packageLoader.getPackage.mockReturnValue({
      manifest: {
        execution: {
          type: "nextflow",
          pipeline: "./workflow",
          version: "0.1.0",
          profiles: ["conda"],
          defaultParams: {},
          priorRunArtifacts: {
            scope: "study",
            configKey: "qcDir",
            sources: {
              fastqc: ["sample_qc_data"],
            },
          },
          paramMap: {
            qcDir: "--qc_dir",
          },
        },
      },
      basePath: packageRoot,
    } as never);
    mocks.db.pipelineRun.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "prior-fastqc",
          pipelineId: "fastqc",
          studyId: "study-1",
          runFolder: priorRunFolder,
          order: null,
          artifacts: [
            {
              id: "fastqc-zip",
              outputId: "sample_qc_data",
              path: priorArtifact,
              sampleId: "sample-1",
            },
          ],
        },
      ]);

    const result = await prepareGenericRun({
      runId: "run-multiqc",
      pipelineId: "multiqc",
      target: {
        type: "study",
        studyId: "study-1",
        sampleIds: ["sample-1"],
      },
      config: {
        // A user-supplied path must never override the executor-owned staging path.
        qcDir: "/tmp/untrusted-qc-inputs",
      },
      executionSettings: baseExecutionSettings(tempDir),
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    const script = await fs.readFile(path.join(result.runFolder!, "run.sh"), "utf8");
    expect(script).toContain("--qc_dir");
    expect(script).toContain(path.join(result.runFolder!, "prior-run-inputs"));
    expect(script).not.toContain("/tmp/untrusted-qc-inputs");

    const inventory = JSON.parse(
      await fs.readFile(
        path.join(result.runFolder!, "prior-run-inputs.json"),
        "utf8"
      )
    );
    expect(inventory.studyId).toBe("study-1");
    expect(inventory.artifacts).toHaveLength(1);
    expect(
      await fs.readFile(inventory.artifacts[0].stagedPath, "utf8")
    ).toBe("fastqc archive bytes");
  });
});

describe("mergeProfiles", () => {
  it("returns manifest profiles with conda when none need adding", () => {
    expect(mergeProfiles(["conda", "docker"])).toBe("conda,docker");
  });

  it("adds conda if not in manifest profiles", () => {
    expect(mergeProfiles(["docker"])).toBe("docker,conda");
  });

  it("merges admin profile with manifest profiles", () => {
    expect(mergeProfiles(["conda"], "test")).toBe("conda,test");
  });

  it("deduplicates profiles case-insensitively", () => {
    expect(mergeProfiles(["conda", "Docker"], "docker")).toBe("conda,Docker");
  });

  it("skips empty strings in admin profile", () => {
    expect(mergeProfiles(["conda"], ",test,")).toBe("conda,test");
  });

  it("skips conda when skipConda is true", () => {
    expect(mergeProfiles(["conda", "docker"], undefined, { skipConda: true })).toBe("docker");
  });

  it("does not add conda when skipConda is true and conda not in manifest", () => {
    expect(mergeProfiles(["docker"], undefined, { skipConda: true })).toBe("docker");
  });

  it("returns empty string for empty inputs with skipConda", () => {
    expect(mergeProfiles([], undefined, { skipConda: true })).toBe("");
  });

  it("returns conda alone when no other profiles", () => {
    expect(mergeProfiles([])).toBe("conda");
  });

  it("merges comma-separated admin profiles", () => {
    expect(mergeProfiles(["conda"], "test,singularity")).toBe("conda,test,singularity");
  });
});
