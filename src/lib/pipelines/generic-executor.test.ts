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
    expect(mocks.db.pipelineRun.update).not.toHaveBeenCalled();
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
    expect(mocks.db.pipelineRun.update).not.toHaveBeenCalled();
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
    expect(mocks.db.pipelineRun.update).toHaveBeenCalledTimes(1);
    const updateCall = mocks.db.pipelineRun.update.mock.calls[0][0];
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
    expect(nextflowConfig).toContain("conda {");
    expect(nextflowConfig).toContain("conda.enabled = true");

    const samplesheet = await fs.readFile(path.join(result.runFolder!, "samplesheet.csv"), "utf8");
    expect(samplesheet).toBe("sample_id\nSAMPLE-1\nSAMPLE-2");
    expect(adapter.generateSamplesheet).toHaveBeenCalledWith({
      target: { type: "order", orderId: "order-1", sampleIds: ["sample-1", "sample-2"] },
      dataBasePath: tempDir,
    });

    expect(mocks.db.pipelineRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        runNumber: expect.stringMatching(/^MAG-\d{8}-008$/),
        runFolder: result.runFolder,
      }),
    });
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
    expect(result.runFolder).toBe(path.resolve(relativeRunDir, path.basename(result.runFolder!)));
    expect(path.isAbsolute(result.runFolder!)).toBe(true);

    const script = await fs.readFile(path.join(result.runFolder!, "run.sh"), "utf8");
    expect(script).toContain(`STDOUT_LOG="${result.runFolder}/logs/pipeline.out"`);
    expect(script).toContain(`STDERR_LOG="${result.runFolder}/logs/pipeline.err"`);
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
    expect(script).toContain("#SBATCH -p gpu");
    expect(script).toContain("#SBATCH -c 16");
    expect(script).toContain("#SBATCH --mem='128GB'");
    expect(script).toContain("#SBATCH -t 24:0:0");
    expect(script).toContain("#SBATCH --gres=gpu:1");
    expect(script).toContain("nf-core/mag");
    expect(script).toContain("-r 2.0.0");

    const config = await fs.readFile(path.join(result.runFolder!, "nextflow.config"), "utf8");
    expect(config).toContain("executor = 'slurm'");
    expect(config).toContain("cpus = 16");
    expect(config).toContain("memory = '128GB'");
    expect(config).toContain("time = '24h'");
    expect(config).toContain("queue = 'gpu'");
    expect(config).toContain("clusterOptions = '--gres=gpu:1'");
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
    expect(script).toContain('CONDA_BASE="/opt/miniconda3"');
    expect(script).toContain('CONDA_ENV="my-env"');
    expect(script).toContain("source \"$CONDA_SH\"");
    expect(script).toContain("conda activate");
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
