import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  execAsync: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("child_process", () => ({
  exec: (...args: unknown[]) => {
    const callback = args[args.length - 1];
    const result = mocks.execAsync(args[0], args[1]);
    if (typeof callback === "function") {
      result.then(
        (val: { stdout: string; stderr: string }) =>
          callback(null, val.stdout, val.stderr),
        (err: Error) => callback(err)
      );
    }
    return {};
  },
}));

import { GET } from "./route";

describe("GET /api/admin/settings/pipelines/auto-detect", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { role: "FACILITY_ADMIN" },
    });
    // Default: no conda available
    mocks.execAsync.mockRejectedValue(new Error("command not found"));
    // Clean env
    delete process.env.CONDA_DEFAULT_ENV;
    delete process.env.CONDA_PREFIX;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { role: "RESEARCHER" },
    });

    const response = await GET();
    expect(response.status).toBe(403);
  });

  it("returns 403 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(403);
  });

  it("returns detected=false when conda is not installed", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.detected).toBe(false);
    expect(body.condaEnv).toBeNull();
    expect(body.condaBase).toBeNull();
  });

  it("returns detected=true when CONDA_DEFAULT_ENV is set and conda exists", async () => {
    process.env.CONDA_DEFAULT_ENV = "seqdesk-pipelines";
    process.env.CONDA_PREFIX = "/opt/conda/envs/seqdesk-pipelines";

    // command -v conda succeeds
    mocks.execAsync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.startsWith("command -v")) {
        return Promise.resolve({ stdout: "/opt/conda/bin/conda", stderr: "" });
      }
      if (typeof cmd === "string" && cmd.startsWith("conda env list")) {
        return Promise.resolve({
          stdout: JSON.stringify({
            envs: [
              "/opt/conda",
              "/opt/conda/envs/seqdesk-pipelines",
            ],
          }),
          stderr: "",
        });
      }
      return Promise.reject(new Error("unexpected"));
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.detected).toBe(true);
    expect(body.condaEnv).toBe("seqdesk-pipelines");
    expect(body.condaBase).toBe("/opt/conda");
  });

  it("returns detected=false with null values when conda commands all fail", async () => {
    // CONDA_PREFIX set but conda not actually available
    process.env.CONDA_PREFIX = "/opt/conda/envs/myenv";

    mocks.execAsync.mockRejectedValue(new Error("command not found"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    // Even though CONDA_PREFIX is set, the env name is inferred
    expect(body.detected).toBe(true);
    expect(body.condaEnv).toBe("myenv");
    expect(body.condaBase).toBe("/opt/conda");
  });
});
