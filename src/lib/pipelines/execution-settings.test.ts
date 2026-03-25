import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    siteSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
  loadConfig: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/config/loader", () => ({
  loadConfig: mocks.loadConfig,
}));

import {
  DEFAULT_EXECUTION_SETTINGS,
  getExecutionSettings,
  saveExecutionSettings,
  type ExecutionSettings,
} from "./execution-settings";

const TEST_RUN_DIRECTORY = "/Users/tester/testdata/pipeline_runs";

function makeSettings(overrides?: Partial<ExecutionSettings>): ExecutionSettings {
  return {
    ...DEFAULT_EXECUTION_SETTINGS,
    ...overrides,
    runtimeMode: "conda",
  };
}

describe("execution-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockReturnValue({
      config: {
        pipelines: {},
      },
      sources: {},
      loadedAt: new Date("2026-03-13T00:00:00Z"),
    });
  });

  it("returns defaults when site settings are missing", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);

    const result = await getExecutionSettings();

    expect(result).toEqual(DEFAULT_EXECUTION_SETTINGS);
  });

  it("returns defaults when extraSettings is invalid JSON", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: "{bad-json",
    });

    const result = await getExecutionSettings();

    expect(result).toEqual(DEFAULT_EXECUTION_SETTINGS);
  });

  it("merges pipelineExecution values and forces runtimeMode to conda", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        pipelineExecution: {
          useSlurm: true,
          slurmCores: 16,
          runtimeMode: "docker",
          condaPath: "/opt/conda",
        },
      }),
    });

    const result = await getExecutionSettings();

    expect(result.useSlurm).toBe(true);
    expect(result.slurmCores).toBe(16);
    expect(result.condaPath).toBe("/opt/conda");
    expect(result.runtimeMode).toBe("conda");
    expect(result.pipelineRunDir).toBe(DEFAULT_EXECUTION_SETTINGS.pipelineRunDir);
  });

  it("prefers file/env execution config over database settings", async () => {
    mocks.loadConfig.mockReturnValue({
      config: {
        pipelines: {
          execution: {
            mode: "local",
            runDirectory: TEST_RUN_DIRECTORY,
            conda: {
              path: "/opt/homebrew/Caskroom/miniconda/base",
              environment: "seqdesk-pipelines",
            },
          },
        },
      },
      sources: {
        "pipelines.execution.mode": "file",
        "pipelines.execution.runDirectory": "file",
        "pipelines.execution.conda.path": "file",
        "pipelines.execution.conda.environment": "file",
      },
      loadedAt: new Date("2026-03-13T00:00:00Z"),
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        pipelineExecution: {
          useSlurm: true,
          pipelineRunDir: "/db/runs",
          condaPath: "/db/conda",
        },
      }),
    });

    const result = await getExecutionSettings();

    expect(result.useSlurm).toBe(false);
    expect(result.pipelineRunDir).toBe(TEST_RUN_DIRECTORY);
    expect(result.condaPath).toBe("/opt/homebrew/Caskroom/miniconda/base");
    expect(result.condaEnv).toBe("seqdesk-pipelines");
  });

  it("saveExecutionSettings creates pipelineExecution payload when none exists", async () => {
    const executionSettings = makeSettings({
      useSlurm: true,
      slurmQueue: "gpu",
    });

    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    mocks.db.siteSettings.upsert.mockResolvedValue({});

    await saveExecutionSettings(executionSettings);

    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);
    const args = mocks.db.siteSettings.upsert.mock.calls[0][0] as {
      create: { extraSettings: string };
      update: { extraSettings: string };
    };

    const createExtra = JSON.parse(args.create.extraSettings);
    const updateExtra = JSON.parse(args.update.extraSettings);

    expect(createExtra).toEqual({ pipelineExecution: executionSettings });
    expect(updateExtra).toEqual({ pipelineExecution: executionSettings });
  });

  it("saveExecutionSettings preserves unrelated extra settings", async () => {
    const executionSettings = makeSettings({
      weblogUrl: "https://example.test/webhook",
    });

    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        ui: { theme: "light" },
        pipelineExecution: { useSlurm: false },
      }),
    });
    mocks.db.siteSettings.upsert.mockResolvedValue({});

    await saveExecutionSettings(executionSettings);

    const args = mocks.db.siteSettings.upsert.mock.calls[0][0] as {
      create: { extraSettings: string };
      update: { extraSettings: string };
    };

    const merged = JSON.parse(args.update.extraSettings);
    expect(merged.ui).toEqual({ theme: "light" });
    expect(merged.pipelineExecution).toEqual(executionSettings);
  });

  it("saveExecutionSettings recovers from invalid existing extra settings", async () => {
    const executionSettings = makeSettings({ slurmTimeLimit: 24 });

    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: "{not-json",
    });
    mocks.db.siteSettings.upsert.mockResolvedValue({});

    await saveExecutionSettings(executionSettings);

    const args = mocks.db.siteSettings.upsert.mock.calls[0][0] as {
      update: { extraSettings: string };
    };
    const merged = JSON.parse(args.update.extraSettings);

    expect(merged).toEqual({ pipelineExecution: executionSettings });
  });
});
