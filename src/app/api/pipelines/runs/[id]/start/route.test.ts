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
});
