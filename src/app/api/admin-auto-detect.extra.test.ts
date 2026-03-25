import { beforeEach, describe, expect, it, vi } from "vitest";

const execAsyncMock = vi.hoisted(() => vi.fn());

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  exec: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("child_process", () => ({
  exec: mocks.exec,
}));

vi.mock("util", () => ({
  promisify: () => execAsyncMock,
}));

import { GET } from "./admin/settings/pipelines/auto-detect/route";

describe("admin conda auto-detect route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.unstubAllEnvs();

    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    execAsyncMock.mockImplementation(async (command: string) => {
      if (command === "command -v conda") {
        return { stdout: "/opt/conda/bin/conda\n", stderr: "" };
      }
      if (command === "conda env list --json") {
        return {
          stdout: JSON.stringify({
            envs: [
              "/opt/conda",
              "/opt/conda/envs/base",
              "/opt/conda/envs/seqdesk-pipelines",
            ],
          }),
          stderr: "",
        };
      }
      if (command === "conda info --base") {
        return { stdout: "/opt/conda\n", stderr: "" };
      }
      throw new Error(`unexpected command: ${command}`);
    });
  });

  it("rejects unauthorized callers", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);

    const response = await GET();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("prefers the seqdesk env, infers the base path, and falls back to conda info --base", async () => {
    vi.stubEnv("CONDA_DEFAULT_ENV", "base");
    vi.stubEnv("CONDA_PREFIX", "");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      detected: true,
      condaEnv: "seqdesk-pipelines",
      condaBase: "/opt/conda",
    });
    expect(execAsyncMock).toHaveBeenCalledWith("command -v conda", { timeout: 5000 });
    expect(execAsyncMock).toHaveBeenCalledWith("conda env list --json", { timeout: 8000 });
    expect(execAsyncMock).toHaveBeenCalledWith("conda info --base", { timeout: 8000 });
  });

  it("derives env and base from CONDA_PREFIX and tolerates missing conda commands", async () => {
    vi.stubEnv("CONDA_DEFAULT_ENV", "");
    vi.stubEnv("CONDA_PREFIX", "/srv/miniconda/envs/custom-env");

    execAsyncMock.mockImplementation(async (command: string) => {
      if (command === "command -v conda") {
        throw new Error("conda missing");
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      detected: true,
      condaEnv: "custom-env",
      condaBase: "/srv/miniconda",
    });
  });

  it("returns a clean undetected payload when no env information is available", async () => {
    vi.stubEnv("CONDA_DEFAULT_ENV", "");
    vi.stubEnv("CONDA_PREFIX", "");

    execAsyncMock.mockImplementation(async (command: string) => {
      if (command === "command -v conda") {
        throw new Error("conda missing");
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      detected: false,
      condaEnv: null,
      condaBase: null,
    });
  });

  it("maps unexpected failures to a 500 response", async () => {
    mocks.getServerSession.mockRejectedValueOnce(new Error("session failed"));

    const response = await GET();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      detected: false,
      message: "Failed to auto-detect conda environment",
    });
  });
});
