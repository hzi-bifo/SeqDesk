import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExecutionSettings } from "@/lib/pipelines/execution-settings";
import type { PrerequisiteCheck } from "@/lib/pipelines/prerequisite-check";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  getExecutionSettings: vi.fn(),
  inspectManagedLocalPath: vi.fn(),
  checkPipelineRuntimePrerequisites: vi.fn(),
}));

vi.mock("@/lib/config/loader", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("@/lib/pipelines/execution-settings", () => ({
  getExecutionSettings: mocks.getExecutionSettings,
}));

vi.mock("@/lib/pipelines/pipeline-readiness-service", () => ({
  inspectManagedLocalPath: mocks.inspectManagedLocalPath,
}));

vi.mock("@/lib/pipelines/prerequisite-check", () => ({
  checkPipelineRuntimePrerequisites: mocks.checkPipelineRuntimePrerequisites,
}));

import {
  checkWorkflowRuntimeReadiness,
  resolveWorkflowRuntimeFingerprint,
} from "./workflow-runtime-readiness";

const BASE_SETTINGS: ExecutionSettings = {
  useSlurm: false,
  slurmQueue: "cpu",
  slurmCores: 4,
  slurmMemory: "64GB",
  slurmTimeLimit: 12,
  slurmOptions: "",
  pipelineOverrides: {},
  runtimeMode: "conda",
  condaPath: "/opt/conda",
  condaEnv: "seqdesk-pipelines",
  condaCacheDir: "/var/cache/conda",
  nextflowProfile: "",
  pipelineRunDir: "/data/pipeline-runs",
  pipelineDatabaseDir: "/data/pipeline-databases",
  weblogUrl: "https://example.test/weblog",
  weblogSecret: "must-not-affect-evidence",
};

function prerequisite(
  overrides: Partial<PrerequisiteCheck> = {}
): PrerequisiteCheck {
  return {
    id: "nextflow",
    name: "Nextflow",
    description: "Workflow engine",
    status: "pass",
    message: "Installed in conda env",
    required: true,
    ...overrides,
  };
}

describe("workflow runtime onboarding readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockReturnValue({
      config: { pipelines: { enabled: true } },
    });
    mocks.getExecutionSettings.mockResolvedValue({ ...BASE_SETTINGS });
    mocks.inspectManagedLocalPath.mockResolvedValue({
      status: "ready",
      detail: "Accessible and writable",
    });
    mocks.checkPipelineRuntimePrerequisites.mockResolvedValue([
      prerequisite(),
      prerequisite({
        id: "java",
        name: "Java",
        message: "Installed in conda env (Java 21)",
      }),
      prerequisite({
        id: "conda",
        name: "Conda",
        message: "Found at configured path",
      }),
    ]);
  });

  it("returns immediately without probes when workflows are disabled", async () => {
    mocks.loadConfig.mockReturnValue({
      config: { pipelines: { enabled: false } },
    });

    const result = await checkWorkflowRuntimeReadiness();

    expect(result).toMatchObject({
      status: "missing",
      ready: false,
      executor: "local",
      checks: [
        expect.objectContaining({
          id: "pipelines-enabled",
          status: "missing",
          blocking: true,
        }),
      ],
    });
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.inspectManagedLocalPath).not.toHaveBeenCalled();
    expect(mocks.checkPipelineRuntimePrerequisites).not.toHaveBeenCalled();
  });

  it("requires a writable run directory and all required runtime checks", async () => {
    const result = await checkWorkflowRuntimeReadiness();

    expect(mocks.inspectManagedLocalPath).toHaveBeenCalledWith({
      targetPath: BASE_SETTINGS.pipelineRunDir,
      writable: true,
    });
    expect(mocks.checkPipelineRuntimePrerequisites).toHaveBeenCalledWith(
      expect.objectContaining(BASE_SETTINGS),
      { nextflowOffline: true }
    );
    expect(result).toMatchObject({
      status: "ready",
      ready: true,
      executor: "local",
      summary: "Workflow runtime is ready.",
    });
    expect(result.checkedAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false);
    expect(result.checks.map((check) => check.id)).toEqual([
      "pipeline-run-directory",
      "nextflow",
      "java",
      "conda",
    ]);
  });

  it("blocks readiness for a missing run directory", async () => {
    mocks.inspectManagedLocalPath.mockResolvedValue({
      status: "missing",
      detail: "Path does not exist or is not writable",
    });

    const result = await checkWorkflowRuntimeReadiness();

    expect(result.status).toBe("missing");
    expect(result.ready).toBe(false);
    expect(result.summary).toContain("Pipeline run directory");
  });

  it("blocks on any required runtime result other than pass", async () => {
    mocks.checkPipelineRuntimePrerequisites.mockResolvedValue([
      prerequisite({ status: "warning", message: "Java 11 found" }),
    ]);

    const result = await checkWorkflowRuntimeReadiness();

    expect(result).toMatchObject({
      status: "missing",
      ready: false,
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: "nextflow",
          status: "warning",
          blocking: true,
          detail: "Java 11 found",
        }),
      ]),
    });
  });

  it("does not block on a non-required warning", async () => {
    mocks.checkPipelineRuntimePrerequisites.mockResolvedValue([
      prerequisite(),
      prerequisite({
        id: "optional-runtime-note",
        name: "Optional runtime note",
        status: "warning",
        message: "Optional tuning is unavailable",
        required: false,
      }),
    ]);

    const result = await checkWorkflowRuntimeReadiness();

    expect(result.status).toBe("ready");
    expect(result.ready).toBe(true);
  });

  it("uses the Slurm executor and includes its queue in the fingerprint", async () => {
    mocks.getExecutionSettings.mockResolvedValue({
      ...BASE_SETTINGS,
      useSlurm: true,
      slurmQueue: "batch",
    });
    const batchFingerprint = await resolveWorkflowRuntimeFingerprint();

    mocks.getExecutionSettings.mockResolvedValue({
      ...BASE_SETTINGS,
      useSlurm: true,
      slurmQueue: "high-memory",
    });
    const highMemoryResult = await checkWorkflowRuntimeReadiness();

    expect(highMemoryResult.executor).toBe("slurm");
    expect(highMemoryResult.fingerprint).not.toBe(batchFingerprint);
  });

  it("resolves fingerprints without probes and ignores secrets and whitespace", async () => {
    const first = await resolveWorkflowRuntimeFingerprint();

    mocks.getExecutionSettings.mockResolvedValue({
      ...BASE_SETTINGS,
      slurmQueue: "irrelevant-for-local",
      condaPath: "  /opt/conda  ",
      condaEnv: " seqdesk-pipelines ",
      pipelineRunDir: " /data/pipeline-runs ",
      weblogSecret: "a-different-secret",
      weblogUrl: "https://another.example.test/weblog",
    });
    const second = await resolveWorkflowRuntimeFingerprint();

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.inspectManagedLocalPath).not.toHaveBeenCalled();
    expect(mocks.checkPipelineRuntimePrerequisites).not.toHaveBeenCalled();
  });

  it("invalidates the fingerprint when readiness-relevant settings change", async () => {
    const first = await resolveWorkflowRuntimeFingerprint();

    mocks.getExecutionSettings.mockResolvedValue({
      ...BASE_SETTINGS,
      pipelineRunDir: "/data/other-pipeline-runs",
    });
    const changedRunDirectory = await resolveWorkflowRuntimeFingerprint();

    mocks.loadConfig.mockReturnValue({
      config: { pipelines: { enabled: false } },
    });
    const disabled = await resolveWorkflowRuntimeFingerprint();

    expect(changedRunDirectory).not.toBe(first);
    expect(disabled).not.toBe(changedRunDirectory);
  });

  it("fails closed without exposing an unexpected probe error", async () => {
    mocks.checkPipelineRuntimePrerequisites.mockRejectedValue(
      new Error("secret command output")
    );

    const result = await checkWorkflowRuntimeReadiness();

    expect(result).toMatchObject({
      status: "error",
      ready: false,
      summary: "SeqDesk could not complete the workflow runtime check.",
      checks: [
        expect.objectContaining({
          id: "workflow-runtime-check",
          status: "missing",
          blocking: true,
        }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain("secret command output");
  });
});
