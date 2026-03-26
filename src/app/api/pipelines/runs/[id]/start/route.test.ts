import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import EventEmitter from "events";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    pipelineRun: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  getResolvedDataBasePath: vi.fn(),
  prepareGenericRun: vi.fn(),
  getPackage: vi.fn(),
  getExecutionSettings: vi.fn(),
  detectRuntimePlatform: vi.fn(),
  isMacOsArmRuntime: vi.fn(),
  resolveCondaBin: vi.fn(),
  getLocalCondaCompatibilityBlockMessage: vi.fn(),
  shouldSkipCondaOnMacArm: vi.fn(),
  prepareSubmgRun: vi.fn(),
  processCompletedPipelineRun: vi.fn(),
  validatePipelineMetadata: vi.fn(),
  isDemoSession: vi.fn(),
  spawn: vi.fn(),
  exec: vi.fn(),
  fsAccess: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/files/data-base-path", () => ({
  getResolvedDataBasePath: mocks.getResolvedDataBasePath,
}));

vi.mock("@/lib/pipelines/generic-executor", () => ({
  prepareGenericRun: mocks.prepareGenericRun,
}));

vi.mock("@/lib/pipelines/package-loader", () => ({
  getPackage: mocks.getPackage,
}));

vi.mock("@/lib/pipelines/execution-settings", () => ({
  getExecutionSettings: mocks.getExecutionSettings,
}));

vi.mock("@/lib/pipelines/runtime-platform", () => ({
  detectRuntimePlatform: mocks.detectRuntimePlatform,
  isMacOsArmRuntime: mocks.isMacOsArmRuntime,
  resolveCondaBin: mocks.resolveCondaBin,
}));

vi.mock("@/lib/pipelines/runtime-compatibility", () => ({
  getLocalCondaCompatibilityBlockMessage:
    mocks.getLocalCondaCompatibilityBlockMessage,
  shouldSkipCondaOnMacArm: mocks.shouldSkipCondaOnMacArm,
}));

vi.mock("@/lib/pipelines/submg/submg-runner", () => ({
  prepareSubmgRun: mocks.prepareSubmgRun,
}));

vi.mock("@/lib/pipelines/run-completion", () => ({
  processCompletedPipelineRun: mocks.processCompletedPipelineRun,
}));

vi.mock("@/lib/pipelines/metadata-validation", () => ({
  validatePipelineMetadata: mocks.validatePipelineMetadata,
}));

vi.mock("@/lib/demo/server", () => ({
  isDemoSession: mocks.isDemoSession,
}));

// Mock child_process. exec needs to work with promisify.
vi.mock("child_process", () => ({
  spawn: mocks.spawn,
  exec: mocks.exec,
}));

vi.mock("fs/promises", () => ({
  default: {
    access: mocks.fsAccess,
  },
}));

import { POST } from "./route";

// Helpers
function makeRequest(body?: unknown) {
  return new NextRequest(
    "http://localhost:3000/api/pipelines/runs/run-1/start",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }
  );
}

function makeChildProcess() {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    unref: ReturnType<typeof vi.fn>;
  };
  child.pid = 12345;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.unref = vi.fn();
  return child;
}

const baseParams = Promise.resolve({ id: "run-1" });

const defaultRun = {
  id: "run-1",
  pipelineId: "fastqc",
  status: "pending",
  config: null,
  inputSampleIds: null,
  targetType: "order",
  orderId: "order-1",
  studyId: null,
  study: null,
  order: { samples: [{ id: "s1", reads: [] }] },
};

const defaultExecutionSettings = {
  condaPath: "/opt/conda",
  pipelineRunDir: "/tmp/runs",
  useSlurm: false,
  nextflowProfile: "",
  runtimeMode: "local",
  slurmQueue: "",
  slurmOptions: "",
};

const defaultPkg = {
  manifest: { name: "fastqc", condaCompatibility: {} },
};

const defaultPlatform = { raw: "linux-x86_64", source: "uname" };

describe("POST /api/pipelines/runs/[id]/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "FACILITY_ADMIN" },
    });
    mocks.isDemoSession.mockReturnValue(false);
    mocks.db.pipelineRun.findUnique.mockResolvedValue(defaultRun);
    mocks.db.pipelineRun.update.mockResolvedValue({});
    mocks.getExecutionSettings.mockResolvedValue(defaultExecutionSettings);
    mocks.getResolvedDataBasePath.mockResolvedValue({ dataBasePath: "/data" });
    mocks.getPackage.mockReturnValue(defaultPkg);
    mocks.detectRuntimePlatform.mockResolvedValue(defaultPlatform);
    mocks.isMacOsArmRuntime.mockReturnValue(false);
    mocks.resolveCondaBin.mockResolvedValue("/opt/conda/bin/conda");
    mocks.getLocalCondaCompatibilityBlockMessage.mockReturnValue(null);
    mocks.shouldSkipCondaOnMacArm.mockReturnValue(false);
    mocks.processCompletedPipelineRun.mockResolvedValue(undefined);
    mocks.validatePipelineMetadata.mockResolvedValue({ issues: [] });
    mocks.prepareGenericRun.mockResolvedValue({
      success: true,
      runFolder: "/tmp/runs/run-1",
    });
    mocks.fsAccess.mockResolvedValue(undefined);

    // exec mock: called via promisify -> returns (command, opts, callback)
    // commandExists calls `command -v nextflow` etc.
    // Make it fail by default (command not found), which is fine when condaBin is set.
    mocks.exec.mockImplementation(
      (
        _cmd: string,
        _opts: unknown,
        callback: (err: Error | null, result: unknown) => void
      ) => {
        callback(new Error("not found"), null);
      }
    );

    // spawn: default returns a mock child process that emits close(0) on next tick
    mocks.spawn.mockImplementation(() => {
      const child = makeChildProcess();
      process.nextTick(() => child.emit("close", 0));
      return child;
    });
  });

  it("returns 403 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(403);
  });

  it("returns 403 for demo sessions", async () => {
    mocks.isDemoSession.mockReturnValue(true);

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain("demo");
  });

  it("returns 404 when run not found", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue(null);

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(404);
  });

  it("returns 400 when run status is not pending", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...defaultRun,
      status: "running",
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Cannot start run with status");
  });

  it("returns 400 when run has no associated target", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...defaultRun,
      targetType: null,
      orderId: null,
      studyId: null,
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("no associated target");
  });

  it("returns 400 when run config is invalid JSON", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...defaultRun,
      config: "not-valid-json{{{",
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("invalid JSON");
  });

  it("returns 400 when metadata validation fails", async () => {
    mocks.validatePipelineMetadata.mockResolvedValue({
      issues: [{ severity: "error", message: "Missing required field" }],
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("metadata validation failed");
    expect(body.details).toContain("Missing required field");
  });

  it("returns 400 when data base path is not configured", async () => {
    mocks.getResolvedDataBasePath.mockResolvedValue({ dataBasePath: null });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Data base path not configured");
  });

  it("returns 400 when pipeline package is not found", async () => {
    mocks.getPackage.mockReturnValue(null);

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Pipeline package not found");
  });

  it("returns 400 when prepareGenericRun fails", async () => {
    mocks.prepareGenericRun.mockResolvedValue({
      success: false,
      errors: ["Missing input files"],
      warnings: [],
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Failed to prepare run");
    expect(body.details).toContain("Missing input files");
  });

  it("returns 400 when pipelineRunDir is not configured", async () => {
    mocks.getExecutionSettings.mockResolvedValue({
      ...defaultExecutionSettings,
      pipelineRunDir: "",
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Pipeline run directory not configured");
  });

  it("returns 400 when inputSampleIds is invalid JSON", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...defaultRun,
      inputSampleIds: "not-json",
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("invalid JSON");
  });

  it("returns 400 when inputSampleIds is an empty array", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...defaultRun,
      inputSampleIds: "[]",
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("sample selection is invalid");
  });

  it("starts a local run successfully and returns running status", async () => {
    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe("running");
    expect(body.pid).toBe(12345);
  });

  it("returns 500 when run script does not exist", async () => {
    mocks.fsAccess.mockRejectedValue(new Error("ENOENT"));

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain("Run script not found");
  });

  it("returns 400 when forbidden profiles are selected", async () => {
    mocks.getExecutionSettings.mockResolvedValue({
      ...defaultExecutionSettings,
      nextflowProfile: "docker,conda",
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Unsupported Nextflow profile");
  });

  it("submits to SLURM via sbatch and returns queued status", async () => {
    mocks.getExecutionSettings.mockResolvedValue({
      ...defaultExecutionSettings,
      useSlurm: true,
      slurmQueue: "batch",
    });
    // sbatch available
    mocks.exec.mockImplementation(
      (
        cmd: string,
        _opts: unknown,
        callback: (err: Error | null, result: unknown) => void
      ) => {
        if (cmd.includes("command -v sbatch")) {
          callback(null, { stdout: "/usr/bin/sbatch" });
        } else {
          callback(new Error("not found"), null);
        }
      }
    );
    // sbatch spawn returns job ID
    mocks.spawn.mockImplementation(() => {
      const child = makeChildProcess();
      process.nextTick(() => {
        child.stdout.emit("data", "98765\n");
        child.emit("close", 0);
      });
      return child;
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe("queued");
    expect(body.jobId).toBe("98765");
  });

  it("returns 500 when sbatch fails with non-zero exit", async () => {
    mocks.getExecutionSettings.mockResolvedValue({
      ...defaultExecutionSettings,
      useSlurm: true,
    });
    mocks.exec.mockImplementation(
      (
        cmd: string,
        _opts: unknown,
        callback: (err: Error | null, result: unknown) => void
      ) => {
        if (cmd.includes("command -v sbatch")) {
          callback(null, { stdout: "/usr/bin/sbatch" });
        } else {
          callback(new Error("not found"), null);
        }
      }
    );
    mocks.spawn.mockImplementation(() => {
      const child = makeChildProcess();
      process.nextTick(() => {
        child.stderr.emit("data", "sbatch: error: invalid partition");
        child.emit("close", 1);
      });
      return child;
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain("sbatch exited with code 1");
  });

  it("returns 500 when sbatch command is not found", async () => {
    mocks.getExecutionSettings.mockResolvedValue({
      ...defaultExecutionSettings,
      useSlurm: true,
    });
    // All commands fail including sbatch
    mocks.exec.mockImplementation(
      (
        _cmd: string,
        _opts: unknown,
        callback: (err: Error | null, result: unknown) => void
      ) => {
        callback(new Error("not found"), null);
      }
    );

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain("sbatch command not found");
  });

  it("local execution: handles exit code non-zero and marks run as failed", async () => {
    mocks.spawn.mockImplementation(() => {
      const child = makeChildProcess();
      process.nextTick(() => child.emit("close", 1));
      return child;
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe("running");

    // Wait for the async close handler
    await new Promise((resolve) => setTimeout(resolve, 50));

    // finalizeLocalRun should have been called with exit code 1
    const updateCalls = mocks.db.pipelineRun.update.mock.calls;
    const failedUpdate = updateCalls.find(
      (call: { 0: { data: { status: string } } }) => call[0].data.status === "failed"
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate[0].data.errorTail).toContain("exited with code 1");
  });

  it("local execution: process error event triggers finalizeLocalRun", async () => {
    mocks.spawn.mockImplementation(() => {
      const child = makeChildProcess();
      process.nextTick(() => child.emit("error", new Error("spawn ENOENT")));
      return child;
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);

    // Wait for the async error handler
    await new Promise((resolve) => setTimeout(resolve, 50));

    const updateCalls = mocks.db.pipelineRun.update.mock.calls;
    const failedUpdate = updateCalls.find(
      (call: { 0: { data: { status: string } } }) => call[0].data.status === "failed"
    );
    expect(failedUpdate).toBeDefined();
  });

  it("selects samples from inputSampleIds field on the run", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...defaultRun,
      inputSampleIds: JSON.stringify(["s1", "s2"]),
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);
    // prepareGenericRun should receive the selected sample IDs in target
    expect(mocks.prepareGenericRun).toHaveBeenCalledTimes(1);
    const prepArgs = mocks.prepareGenericRun.mock.calls[0][0];
    expect(prepArgs.target.sampleIds).toEqual(["s1", "s2"]);
  });

  it("selects samples from request body sampleIds", async () => {
    const response = await POST(
      makeRequest({ sampleIds: ["s1"] }),
      { params: baseParams }
    );

    expect(response.status).toBe(200);
    expect(mocks.prepareGenericRun).toHaveBeenCalledTimes(1);
    const prepArgs = mocks.prepareGenericRun.mock.calls[0][0];
    expect(prepArgs.target.sampleIds).toEqual(["s1"]);
  });

  it("resolves conda binary via resolveCondaBin", async () => {
    mocks.resolveCondaBin.mockResolvedValue("/custom/conda/bin/conda");

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);
    expect(mocks.resolveCondaBin).toHaveBeenCalledWith("/opt/conda");
  });

  it("constructs effective profile with conda appended", async () => {
    mocks.getExecutionSettings.mockResolvedValue({
      ...defaultExecutionSettings,
      nextflowProfile: "test",
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);
    const prepArgs = mocks.prepareGenericRun.mock.calls[0][0];
    // "test" should get "conda" appended -> "test,conda"
    expect(prepArgs.executionSettings.nextflowProfile).toBe("test,conda");
  });

  it("finalizeLocalRun with exit code 0 marks run as completed and triggers output processing", async () => {
    mocks.spawn.mockImplementation(() => {
      const child = makeChildProcess();
      process.nextTick(() => child.emit("close", 0));
      return child;
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);

    // Wait for the async close handler
    await new Promise((resolve) => setTimeout(resolve, 50));

    const updateCalls = mocks.db.pipelineRun.update.mock.calls;
    const completedUpdate = updateCalls.find(
      (call: { 0: { data: { status: string } } }) => call[0].data.status === "completed"
    );
    expect(completedUpdate).toBeDefined();
    expect(completedUpdate[0].data.progress).toBe(100);
    expect(completedUpdate[0].data.currentStep).toBe("Completed");
    expect(mocks.processCompletedPipelineRun).toHaveBeenCalledWith("run-1", "fastqc");
  });

  it("parses valid custom config object from run.config", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...defaultRun,
      config: JSON.stringify({ maxCpus: 4, customParam: "value" }),
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);
    const prepArgs = mocks.prepareGenericRun.mock.calls[0][0];
    expect(prepArgs.config).toEqual({ maxCpus: 4, customParam: "value" });
  });

  it("resolves effective profile with multiple comma-separated values", async () => {
    mocks.getExecutionSettings.mockResolvedValue({
      ...defaultExecutionSettings,
      nextflowProfile: "test,custom",
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);
    const prepArgs = mocks.prepareGenericRun.mock.calls[0][0];
    // "test,custom" should get "conda" appended -> "test,custom,conda"
    expect(prepArgs.executionSettings.nextflowProfile).toBe("test,custom,conda");
  });

  it("does not duplicate conda in effective profile when already present", async () => {
    mocks.getExecutionSettings.mockResolvedValue({
      ...defaultExecutionSettings,
      nextflowProfile: "conda,test",
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);
    const prepArgs = mocks.prepareGenericRun.mock.calls[0][0];
    expect(prepArgs.executionSettings.nextflowProfile).toBe("conda,test");
  });

  it("returns 400 when inputSampleIds is not an array", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...defaultRun,
      inputSampleIds: JSON.stringify("not-an-array"),
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("sample selection is invalid");
  });

  it("returns 400 when inputSampleIds contains non-string values", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...defaultRun,
      inputSampleIds: JSON.stringify([123, 456]),
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("sample selection is invalid");
  });

  it("returns 400 when request body sampleIds is empty array", async () => {
    const response = await POST(
      makeRequest({ sampleIds: [] }),
      { params: baseParams }
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("sample selection is invalid");
  });

  it("returns 400 when request body sampleIds contains non-string values", async () => {
    const response = await POST(
      makeRequest({ sampleIds: [123] }),
      { params: baseParams }
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("sample selection is invalid");
  });

  it("persists sampleIds from request body to run when run has no inputSampleIds", async () => {
    const response = await POST(
      makeRequest({ sampleIds: ["s1", "s2"] }),
      { params: baseParams }
    );

    expect(response.status).toBe(200);
    // Should have called update to persist the sampleIds
    const updateCalls = mocks.db.pipelineRun.update.mock.calls;
    const sampleUpdate = updateCalls.find(
      (call: { 0: { data: { inputSampleIds?: string } } }) =>
        call[0].data.inputSampleIds !== undefined
    );
    expect(sampleUpdate).toBeDefined();
    expect(JSON.parse(sampleUpdate[0].data.inputSampleIds)).toEqual(["s1", "s2"]);
  });

  it("returns 400 when conda compatibility blocks the run", async () => {
    mocks.getLocalCondaCompatibilityBlockMessage.mockReturnValue(
      "macOS ARM is not supported for this pipeline"
    );

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("macOS ARM is not supported");
    // Should have updated the run to failed status
    expect(mocks.db.pipelineRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          statusSource: "launcher",
        }),
      })
    );
  });

  it("returns 400 when neither conda nor nextflow is available for local execution", async () => {
    mocks.resolveCondaBin.mockResolvedValue(null);
    // nextflow also not available (exec mock already rejects all commands)

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Neither conda nor nextflow were found");
  });

  it("warns but proceeds when conda is missing but nextflow is available", async () => {
    mocks.resolveCondaBin.mockResolvedValue(null);
    // Make `command -v nextflow` succeed
    mocks.exec.mockImplementation(
      (
        cmd: string,
        _opts: unknown,
        callback: (err: Error | null, result: unknown) => void
      ) => {
        if (cmd.includes("command -v nextflow")) {
          callback(null, { stdout: "/usr/local/bin/nextflow" });
        } else {
          callback(new Error("not found"), null);
        }
      }
    );

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it("handles study-based target correctly", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...defaultRun,
      targetType: "study",
      orderId: null,
      studyId: "study-1",
      order: null,
      study: { samples: [{ id: "s1", reads: [] }] },
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);
    const prepArgs = mocks.prepareGenericRun.mock.calls[0][0];
    expect(prepArgs.target).toEqual({ type: "study", studyId: "study-1" });
  });

  it("returns 500 on top-level unexpected error", async () => {
    mocks.db.pipelineRun.findUnique.mockRejectedValue(
      new Error("Unexpected DB error")
    );

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Failed to start pipeline run");
  });

  it("sbatch returns job ID with cluster suffix", async () => {
    mocks.getExecutionSettings.mockResolvedValue({
      ...defaultExecutionSettings,
      useSlurm: true,
      slurmQueue: "batch",
      slurmOptions: '--mem=64G --time=48:00:00',
    });
    mocks.exec.mockImplementation(
      (
        cmd: string,
        _opts: unknown,
        callback: (err: Error | null, result: unknown) => void
      ) => {
        if (cmd.includes("command -v sbatch")) {
          callback(null, { stdout: "/usr/bin/sbatch" });
        } else {
          callback(new Error("not found"), null);
        }
      }
    );
    mocks.spawn.mockImplementation(() => {
      const child = makeChildProcess();
      process.nextTick(() => {
        // parsable output with cluster suffix: "12345;cluster"
        child.stdout.emit("data", "12345;mycluster\n");
        child.emit("close", 0);
      });
      return child;
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jobId).toBe("12345");
  });

  it("sbatch failure when no job id is returned", async () => {
    mocks.getExecutionSettings.mockResolvedValue({
      ...defaultExecutionSettings,
      useSlurm: true,
    });
    mocks.exec.mockImplementation(
      (
        cmd: string,
        _opts: unknown,
        callback: (err: Error | null, result: unknown) => void
      ) => {
        if (cmd.includes("command -v sbatch")) {
          callback(null, { stdout: "/usr/bin/sbatch" });
        } else {
          callback(new Error("not found"), null);
        }
      }
    );
    mocks.spawn.mockImplementation(() => {
      const child = makeChildProcess();
      process.nextTick(() => {
        // sbatch exits 0 but no job id in output
        child.stdout.emit("data", "no job id here\n");
        child.emit("close", 0);
      });
      return child;
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain("sbatch did not return a job id");
  });

  it("returns success without execution when prepResult has no runFolder", async () => {
    mocks.prepareGenericRun.mockResolvedValue({
      success: true,
      runFolder: null,
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.runFolder).toBeNull();
    // spawn should not have been called
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("uses scriptPath from prepResult when available", async () => {
    mocks.prepareGenericRun.mockResolvedValue({
      success: true,
      runFolder: "/tmp/runs/run-1",
      scriptPath: "/tmp/runs/run-1/custom-run.sh",
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);
    // spawn should be called with the custom script path
    expect(mocks.spawn).toHaveBeenCalledWith(
      "bash",
      ["/tmp/runs/run-1/custom-run.sh"],
      expect.any(Object)
    );
  });
});
