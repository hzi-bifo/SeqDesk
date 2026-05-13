import { describe, expect, it } from "vitest";
import {
  buildExecutionProfileJson,
  normalizeRunExecutionOverride,
  parseRunExecutionProfileRequest,
  resolvePipelineExecutionPolicy,
  serializeRunExecutionRequest,
} from "./execution-policy";
import {
  DEFAULT_EXECUTION_SETTINGS,
  type ExecutionSettings,
} from "./execution-settings";

function makeSettings(overrides: Partial<ExecutionSettings> = {}): ExecutionSettings {
  return {
    ...DEFAULT_EXECUTION_SETTINGS,
    ...overrides,
    runtimeMode: "conda",
    pipelineOverrides: overrides.pipelineOverrides || {},
  };
}

describe("execution-policy", () => {
  it("defaults to local execution when global SLURM is disabled", () => {
    const policy = resolvePipelineExecutionPolicy({
      pipelineId: "fastqc",
      settings: makeSettings({ useSlurm: false }),
    });

    expect(policy.mode).toBe("local");
    expect(policy.source).toBe("global");
    expect(policy.settings.useSlurm).toBe(false);
    expect(policy.profile.slurm).toBeUndefined();
  });

  it("keeps legacy global useSlurm behavior", () => {
    const policy = resolvePipelineExecutionPolicy({
      pipelineId: "fastqc",
      settings: makeSettings({
        useSlurm: true,
        slurmQueue: "batch",
        slurmCores: 8,
      }),
    });

    expect(policy.mode).toBe("slurm");
    expect(policy.source).toBe("global");
    expect(policy.settings.useSlurm).toBe(true);
    expect(policy.settings.slurmQueue).toBe("batch");
    expect(policy.settings.slurmCores).toBe(8);
  });

  it("applies per-pipeline SLURM overrides on top of global defaults", () => {
    const policy = resolvePipelineExecutionPolicy({
      pipelineId: "mag",
      settings: makeSettings({
        useSlurm: false,
        slurmQueue: "cpu",
        slurmCores: 4,
        slurmMemory: "32GB",
        pipelineOverrides: {
          mag: {
            mode: "slurm",
            slurm: {
              queue: "bigmem",
              cores: 24,
              memory: "256GB",
            },
            nextflowProfile: "slurm",
          },
        },
      }),
    });

    expect(policy.mode).toBe("slurm");
    expect(policy.source).toBe("pipeline");
    expect(policy.settings.useSlurm).toBe(true);
    expect(policy.settings.slurmQueue).toBe("bigmem");
    expect(policy.settings.slurmCores).toBe(24);
    expect(policy.settings.slurmMemory).toBe("256GB");
    expect(policy.settings.slurmTimeLimit).toBe(DEFAULT_EXECUTION_SETTINGS.slurmTimeLimit);
    expect(policy.settings.nextflowProfile).toBe("slurm");
  });

  it("lets per-run local override beat pipeline and global SLURM", () => {
    const policy = resolvePipelineExecutionPolicy({
      pipelineId: "metaxpath",
      settings: makeSettings({
        useSlurm: true,
        pipelineOverrides: {
          metaxpath: { mode: "slurm", slurm: { queue: "long" } },
        },
      }),
      runOverride: { executionMode: "local" },
    });

    expect(policy.mode).toBe("local");
    expect(policy.source).toBe("run");
    expect(policy.settings.useSlurm).toBe(false);
  });

  it("lets per-run SLURM override beat global local and merge resources", () => {
    const policy = resolvePipelineExecutionPolicy({
      pipelineId: "fastqc",
      settings: makeSettings({
        useSlurm: false,
        slurmQueue: "cpu",
        slurmCores: 2,
      }),
      runOverride: {
        executionMode: "slurm",
        slurm: {
          cores: 12,
          options: "--account=dev",
        },
      },
    });

    expect(policy.mode).toBe("slurm");
    expect(policy.source).toBe("run");
    expect(policy.settings.slurmQueue).toBe("cpu");
    expect(policy.settings.slurmCores).toBe(12);
    expect(policy.settings.slurmOptions).toBe("--account=dev");
  });

  it("normalizes invalid run override values away", () => {
    expect(
      normalizeRunExecutionOverride({
        executionMode: "cluster",
        slurm: { cores: 0, queue: "" },
      })
    ).toBeUndefined();
  });

  it("round-trips stored run execution requests separately from resolved snapshots", () => {
    const request = normalizeRunExecutionOverride({
      executionMode: "slurm",
      slurm: { queue: "dev", cores: "4" },
    });
    const serialized = serializeRunExecutionRequest(request);

    expect(parseRunExecutionProfileRequest(serialized)).toEqual({
      executionMode: "slurm",
      slurm: { queue: "dev", cores: 4 },
    });

    const policy = resolvePipelineExecutionPolicy({
      pipelineId: "mag",
      settings: makeSettings(),
      runOverride: request,
    });
    const snapshot = buildExecutionProfileJson(
      policy,
      new Date("2026-05-13T12:00:00.000Z")
    );

    expect(JSON.parse(snapshot)).toEqual(
      expect.objectContaining({
        mode: "slurm",
        source: "run",
        pipelineId: "mag",
        resolvedAt: "2026-05-13T12:00:00.000Z",
      })
    );
  });
});
