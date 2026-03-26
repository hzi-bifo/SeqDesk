import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ExecError = Error & { code?: string; stdout?: string; stderr?: string };
type ExecResponse = { stdout?: string; stderr?: string; error?: ExecError };
type ExecCallback = (error: ExecError | null, stdout?: string, stderr?: string) => void;

const mocks = vi.hoisted(() => ({
  execMock: vi.fn(),
  fsAccessMock: vi.fn(),
  fsWriteFileMock: vi.fn(),
  fsUnlinkMock: vi.fn(),
  fsMkdirMock: vi.fn(),
  detectRuntimePlatformMock: vi.fn(),
  isMacOsArmRuntimeMock: vi.fn(),
}));

const {
  execMock,
  fsAccessMock,
  fsWriteFileMock,
  fsUnlinkMock,
  fsMkdirMock,
  detectRuntimePlatformMock,
  isMacOsArmRuntimeMock,
} = mocks;

vi.mock("child_process", () => ({
  exec: mocks.execMock,
}));

vi.mock("fs/promises", () => ({
  default: {
    access: mocks.fsAccessMock,
    writeFile: mocks.fsWriteFileMock,
    unlink: mocks.fsUnlinkMock,
    mkdir: mocks.fsMkdirMock,
  },
  access: mocks.fsAccessMock,
  writeFile: mocks.fsWriteFileMock,
  unlink: mocks.fsUnlinkMock,
  mkdir: mocks.fsMkdirMock,
}));

vi.mock("./runtime-platform", () => ({
  detectRuntimePlatform: mocks.detectRuntimePlatformMock,
  isMacOsArmRuntime: mocks.isMacOsArmRuntimeMock,
}));

vi.mock("util", () => ({
  promisify:
    (fn: (...args: unknown[]) => void) =>
    (command: string, options?: unknown) =>
      new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        fn(
          command,
          options,
          (error: ExecError | null, stdout = "", stderr = "") => {
            if (error) {
              if (!error.stdout) {
                error.stdout = stdout;
              }
              if (!error.stderr) {
                error.stderr = stderr;
              }
              reject(error);
              return;
            }
            resolve({ stdout, stderr });
          }
        );
      }),
}));

import {
  checkAllPrerequisites,
  detectVersions,
  quickPrerequisiteCheck,
  testSetting,
} from "./prerequisite-check";

let execResponder: (command: string) => ExecResponse;

function createExecError(
  message: string,
  code?: string,
  stdout = "",
  stderr = ""
): ExecError {
  const error = new Error(message) as ExecError;
  if (code) {
    error.code = code;
  }
  error.stdout = stdout;
  error.stderr = stderr;
  return error;
}

function createFsError(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);

  execResponder = (command: string) => {
    throw new Error(`Unhandled exec command: ${command}`);
  };

  execMock.mockImplementation(
    (
      command: string,
      optionsOrCallback: unknown,
      maybeCallback?: ExecCallback
    ) => {
      const callback =
        typeof optionsOrCallback === "function"
          ? (optionsOrCallback as ExecCallback)
          : maybeCallback;

      if (!callback) {
        throw new Error("Missing exec callback");
      }

      let response: ExecResponse;
      try {
        response = execResponder(String(command));
      } catch (error) {
        const err =
          error instanceof Error ? (error as ExecError) : createExecError(String(error));
        queueMicrotask(() => callback(err, "", ""));
        return {} as never;
      }

      queueMicrotask(() => {
        if (response.error) {
          if (response.stdout !== undefined) {
            response.error.stdout = response.stdout;
          }
          if (response.stderr !== undefined) {
            response.error.stderr = response.stderr;
          }
          callback(response.error, response.stdout ?? "", response.stderr ?? "");
          return;
        }
        callback(null, response.stdout ?? "", response.stderr ?? "");
      });

      return {} as never;
    }
  );

  fsAccessMock.mockResolvedValue(undefined);
  fsWriteFileMock.mockResolvedValue(undefined);
  fsUnlinkMock.mockResolvedValue(undefined);
  fsMkdirMock.mockResolvedValue(undefined);

  detectRuntimePlatformMock.mockResolvedValue({
    raw: "linux-64",
    source: "conda-subdir",
  });
  isMacOsArmRuntimeMock.mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("prerequisite-check", () => {
  it("reports all checks passing when runtime requirements are available", async () => {
    execResponder = (command: string) => {
      if (command === "which conda") {
        return { stdout: "/usr/bin/conda\n" };
      }
      if (command === "conda env list" || command === "'conda' env list") {
        return {
          stdout:
            "base * /opt/conda\nseqdesk-pipelines /opt/conda/envs/seqdesk-pipelines\n",
        };
      }
      if (command.includes("conda run -n seqdesk-pipelines nextflow -version")) {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command.includes("conda run -n seqdesk-pipelines java -version")) {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      if (command === "conda --version") {
        return { stdout: "conda 24.9.1\n" };
      }
      if (command.includes("create --yes --quiet --dry-run")) {
        return { stdout: "Dry run complete\n" };
      }
      if (command === "conda config --show channels") {
        return { stdout: "channels:\n  - conda-forge\n  - bioconda\n" };
      }
      if (command.includes("nf-core --version")) {
        return { stdout: "nf-core, version 2.14.1\n" };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const result = await checkAllPrerequisites(
      {
        useSlurm: false,
        pipelineRunDir: "/tmp/seqdesk-runs",
        condaEnv: "seqdesk-pipelines",
      },
      "/tmp/seqdesk-data"
    );

    expect(result.checks).toHaveLength(10);
    expect(result.requiredPassed).toBe(true);
    expect(result.allPassed).toBe(true);
    expect(result.summary).toBe("All checks passed - ready to run pipelines");
    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
    expect(fsWriteFileMock).toHaveBeenCalledWith("/tmp/seqdesk-runs/.seqdesk-test", "test");
  });

  it("converts conda warnings into required failures in the full readiness check", async () => {
    fsAccessMock.mockImplementation(async (target: string) => {
      if (String(target).startsWith("/broken-conda/")) {
        throw createFsError("ENOENT");
      }
    });

    execResponder = (command: string) => {
      if (command === "which conda") {
        return { stdout: "/usr/bin/conda\n" };
      }
      if (command === "conda env list" || command === "'conda' env list") {
        return { stdout: "base * /opt/conda\n" };
      }
      if (command === "nextflow -version") {
        return { stdout: "nextflow version 24.04.2.5914\n" };
      }
      if (command === "java -version 2>&1") {
        return { stderr: 'openjdk version "17.0.8"\n' };
      }
      if (command === "conda --version") {
        return { stdout: "conda 24.9.1\n" };
      }
      if (command.includes("create --yes --quiet --dry-run")) {
        return { stdout: "Dry run complete\n" };
      }
      if (command === "conda config --show channels") {
        return { stdout: "channels:\n  - defaults\n  - conda-forge\n" };
      }
      if (command.includes("nf-core --version")) {
        return { error: createExecError("nf-core not found", "ENOENT") };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const result = await checkAllPrerequisites(
      {
        useSlurm: false,
        condaPath: "/broken-conda",
        pipelineRunDir: "/tmp/seqdesk-runs",
      },
      "/tmp/seqdesk-data"
    );

    expect(result.requiredPassed).toBe(false);
    expect(result.allPassed).toBe(false);
    expect(result.summary).toContain("Conda/Mamba");

    const condaCheck = result.checks.find((check) => check.id === "conda");
    expect(condaCheck?.status).toBe("fail");
  });

  it("reports missing critical checks in quick readiness mode", async () => {
    fsAccessMock.mockImplementation(async (target: string) => {
      if (String(target) === "/tmp/missing-data") {
        throw createFsError("ENOENT");
      }
    });

    execResponder = (command: string) => {
      if (command === "which conda") {
        return { error: createExecError("conda not found", "ENOENT") };
      }
      if (command === "nextflow -version") {
        return { error: createExecError("nextflow not found", "ENOENT") };
      }
      if (command === "conda --version" || command === "mamba --version") {
        return { error: createExecError("runtime not found", "ENOENT") };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const result = await quickPrerequisiteCheck(
      {
        useSlurm: false,
        pipelineRunDir: "/tmp/seqdesk-runs",
      },
      "/tmp/missing-data"
    );

    expect(result.ready).toBe(false);
    expect(result.summary).toContain("Nextflow");
    expect(result.summary).toContain("Data Base Path");
    expect(result.summary).toContain("Conda/Mamba");
  });

  it("tests weblog endpoint reachability using JSON payload input", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("not found", { status: 404 }));

    const result = await testSetting(
      "weblogUrl",
      JSON.stringify({
        url: "https://example.org/api/pipelines/weblog",
        secret: "secret-token",
      })
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("Endpoint reachable");
    expect(fetchSpy).toHaveBeenCalledOnce();

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("runId=weblog-test");
    expect(String(url)).toContain("token=secret-token");
    expect(init?.method).toBe("POST");
  });

  it("rejects invalid weblog URLs", async () => {
    const result = await testSetting("weblogUrl", "not-a-valid-url");
    expect(result).toEqual({
      success: false,
      message: "Invalid URL",
    });
  });

  it("reports conda path success with Terms of Service warning details", async () => {
    fsAccessMock.mockImplementation(async (target: string) => {
      if (String(target) === "/opt/conda/bin/conda") {
        throw createFsError("ENOENT");
      }
    });

    execResponder = (command: string) => {
      if (command === "/opt/conda/condabin/conda --version") {
        return { stdout: "conda 24.8.0\n" };
      }
      if (command.includes("create --yes --quiet --dry-run")) {
        return {
          error: createExecError(
            "CondaToSNonInteractiveError",
            "EACCES",
            "",
            "Terms of Service have not been accepted for defaults channels"
          ),
        };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const result = await testSetting("condaPath", "/opt/conda");

    expect(result.success).toBe(true);
    expect(result.message).toContain("defaults channel not usable without ToS");
    expect(result.details).toContain("/opt/conda/condabin/conda");
    expect(result.details).toContain("config --remove channels defaults");
  });

  it("detects tool versions from the configured conda environment", async () => {
    execResponder = (command: string) => {
      if (command === "/opt/conda/condabin/conda --version") {
        return { stdout: "conda 24.9.1\n" };
      }
      if (command === "/opt/conda/condabin/conda env list") {
        return {
          stdout:
            "base * /opt/conda\nseqdesk-pipelines /opt/conda/envs/seqdesk-pipelines\n",
        };
      }
      if (command.includes("run -n seqdesk-pipelines nextflow -version")) {
        return { stdout: "nextflow version 24.04.2.5914\n" };
      }
      if (command.includes("run -n seqdesk-pipelines nf-core --version")) {
        return { stdout: "nf-core, version 2.14.1\n" };
      }
      if (command.includes("run -n seqdesk-pipelines java -version")) {
        return { stderr: 'openjdk version "17.0.10"\n' };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const versions = await detectVersions("/opt/conda", "seqdesk-pipelines");

    expect(versions).toEqual({
      conda: "24.9.1",
      condaEnv: "seqdesk-pipelines",
      nextflow: "24.04.2",
      nfcore: "2.14.1",
      java: "17",
    });
  });

  it("falls back to PATH tools in detectVersions when conda env is missing", async () => {
    execResponder = (command: string) => {
      if (command === "conda --version") {
        return { stdout: "conda 24.9.1\n" };
      }
      if (command === "conda env list") {
        return { stdout: "base * /opt/conda\n" };
      }
      if (command === "nextflow -version") {
        return { stdout: "nextflow version 25.01.0.1234\n" };
      }
      if (command === "nf-core --version") {
        return { stdout: "nf-core, version 2.15.0\n" };
      }
      if (command === "java -version 2>&1") {
        return { stderr: 'openjdk version "21.0.2"\n' };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const versions = await detectVersions();

    expect(versions).toEqual({
      conda: "24.9.1",
      nextflow: "25.01.0",
      nfcore: "2.15.0",
      java: "21",
    });
  });

  it("parses the nextflow version through testSetting", async () => {
    execResponder = (command: string) => {
      if (command === "nextflow -version") {
        return { stdout: "nextflow version 24.04.2.5914\n" };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const result = await testSetting("nextflow");

    expect(result.success).toBe(true);
    expect(result.version).toBe("24.04.2");
  });

  it("returns a clear response for unknown testSetting keys", async () => {
    const result = await testSetting("unknown" as never);
    expect(result).toEqual({
      success: false,
      message: "Unknown setting",
    });
  });

  it("tests pipelineRunDir setting with no value", async () => {
    const result = await testSetting("pipelineRunDir");
    expect(result).toEqual({
      success: false,
      message: "No path provided",
    });
  });

  it("tests pipelineRunDir setting with a writable path", async () => {
    fsAccessMock.mockResolvedValue(undefined);
    fsWriteFileMock.mockResolvedValue(undefined);
    fsUnlinkMock.mockResolvedValue(undefined);

    const result = await testSetting("pipelineRunDir", "/tmp/runs");
    expect(result.success).toBe(true);
    expect(result.message).toContain("writable");
  });

  it("tests condaPath with no value and system conda available", async () => {
    execResponder = (command: string) => {
      if (command === "conda --version") {
        return { stdout: "conda 24.9.1\n" };
      }
      if (command.includes("create --yes --quiet --dry-run")) {
        return { stdout: "Dry run complete\n" };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const result = await testSetting("condaPath");
    expect(result.success).toBe(true);
    expect(result.message).toContain("PATH");
    expect(result.version).toBe("conda 24.9.1");
  });

  it("tests condaPath with no value and no system conda", async () => {
    execResponder = () => {
      return { error: createExecError("not found", "ENOENT") };
    };

    const result = await testSetting("condaPath");
    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("tests condaPath with an invalid path", async () => {
    fsAccessMock.mockRejectedValue(createFsError("ENOENT"));

    execResponder = () => {
      return { error: createExecError("not found", "ENOENT") };
    };

    const result = await testSetting("condaPath", "/nonexistent/conda");
    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("tests slurm setting", async () => {
    execResponder = (command: string) => {
      if (command === "sinfo --version") {
        return { stdout: "slurm 23.11.0\n" };
      }
      if (command.includes("sinfo -h")) {
        return { stdout: "normal* up\n" };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const result = await testSetting("slurm");
    expect(result.success).toBe(true);
    expect(result.message).toBe("Available");
  });

  it("tests nfcore setting when installed in PATH", async () => {
    execResponder = (command: string) => {
      if (command === "which conda") {
        return { error: createExecError("not found", "ENOENT") };
      }
      if (command === "nf-core --version 2>&1") {
        return { stdout: "nf-core, version 2.14.1\n" };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const result = await testSetting("nfcore");
    expect(result.success).toBe(true);
    expect(result.version).toBe("2.14.1");
  });

  it("tests weblogUrl with no value", async () => {
    const result = await testSetting("weblogUrl");
    expect(result).toEqual({
      success: false,
      message: "No URL provided",
    });
  });

  it("tests weblogUrl when fetch returns 403", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("forbidden", { status: 403 }));

    const result = await testSetting(
      "weblogUrl",
      "https://example.org/api/pipelines/weblog"
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("Unauthorized");
    fetchSpy.mockRestore();
  });

  it("tests weblogUrl when fetch returns 200", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    const result = await testSetting(
      "weblogUrl",
      "https://example.org/api/pipelines/weblog"
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("reachable");
    fetchSpy.mockRestore();
  });

  it("tests weblogUrl when fetch fails with network error", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("fetch failed"));

    const result = await testSetting(
      "weblogUrl",
      "https://example.org/api/pipelines/weblog"
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("Request failed");
    fetchSpy.mockRestore();
  });

  it("detects versions returning empty when all commands fail", async () => {
    execResponder = () => {
      return { error: createExecError("not found", "ENOENT") };
    };

    const versions = await detectVersions();
    expect(versions).toEqual({});
  });

  it("checkAllPrerequisites with SLURM enabled passes platform check", async () => {
    execResponder = (command: string) => {
      if (command === "which conda") {
        return { stdout: "/usr/bin/conda\n" };
      }
      if (command === "conda env list" || command === "'conda' env list") {
        return {
          stdout:
            "base * /opt/conda\nseqdesk-pipelines /opt/conda/envs/seqdesk-pipelines\n",
        };
      }
      if (command.includes("conda run -n seqdesk-pipelines nextflow -version")) {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command.includes("conda run -n seqdesk-pipelines java -version")) {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      if (command === "conda --version") {
        return { stdout: "conda 24.9.1\n" };
      }
      if (command.includes("create --yes --quiet --dry-run")) {
        return { stdout: "Dry run complete\n" };
      }
      if (command === "conda config --show channels") {
        return { stdout: "channels:\n  - conda-forge\n  - bioconda\n" };
      }
      if (command.includes("nf-core --version")) {
        return { stdout: "nf-core, version 2.14.1\n" };
      }
      if (command === "sinfo --version") {
        return { stdout: "slurm 23.11.0\n" };
      }
      if (command.includes("sinfo -h")) {
        return { stdout: "normal* up\n" };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const result = await checkAllPrerequisites(
      {
        useSlurm: true,
        pipelineRunDir: "/tmp/seqdesk-runs",
        condaEnv: "seqdesk-pipelines",
      },
      "/tmp/seqdesk-data"
    );

    expect(result.requiredPassed).toBe(true);
    const platformCheck = result.checks.find((c) => c.id === "conda_platform");
    expect(platformCheck?.status).toBe("pass");
    expect(platformCheck?.message).toContain("SLURM");
  });

  it("checkAllPrerequisites fails when macOS ARM is detected", async () => {
    isMacOsArmRuntimeMock.mockReturnValue(true);
    detectRuntimePlatformMock.mockResolvedValue({
      raw: "osx-arm64",
      source: "conda-subdir",
    });

    execResponder = (command: string) => {
      if (command === "which conda") {
        return { stdout: "/usr/bin/conda\n" };
      }
      if (command === "conda env list" || command === "'conda' env list") {
        return {
          stdout:
            "base * /opt/conda\nseqdesk-pipelines /opt/conda/envs/seqdesk-pipelines\n",
        };
      }
      if (command.includes("conda run -n seqdesk-pipelines nextflow -version")) {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command.includes("conda run -n seqdesk-pipelines java -version")) {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      if (command === "conda --version") {
        return { stdout: "conda 24.9.1\n" };
      }
      if (command.includes("create --yes --quiet --dry-run")) {
        return { stdout: "Dry run complete\n" };
      }
      if (command === "conda config --show channels") {
        return { stdout: "channels:\n  - conda-forge\n  - bioconda\n" };
      }
      if (command.includes("nf-core --version")) {
        return { stdout: "nf-core, version 2.14.1\n" };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const result = await checkAllPrerequisites(
      {
        useSlurm: false,
        pipelineRunDir: "/tmp/seqdesk-runs",
        condaEnv: "seqdesk-pipelines",
      },
      "/tmp/seqdesk-data"
    );

    const platformCheck = result.checks.find((c) => c.id === "conda_platform");
    expect(platformCheck?.status).toBe("fail");
    expect(platformCheck?.message).toContain("macOS ARM");
  });

  it("quickPrerequisiteCheck returns ready when all critical checks pass", async () => {
    execResponder = (command: string) => {
      if (command === "which conda") {
        return { stdout: "/usr/bin/conda\n" };
      }
      if (command === "conda env list" || command === "'conda' env list") {
        return {
          stdout:
            "base * /opt/conda\nseqdesk-pipelines /opt/conda/envs/seqdesk-pipelines\n",
        };
      }
      if (command.includes("conda run -n seqdesk-pipelines nextflow -version")) {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command === "conda --version") {
        return { stdout: "conda 24.9.1\n" };
      }
      if (command.includes("create --yes --quiet --dry-run")) {
        return { stdout: "Dry run complete\n" };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const result = await quickPrerequisiteCheck(
      {
        useSlurm: false,
        pipelineRunDir: "/tmp/seqdesk-runs",
        condaEnv: "seqdesk-pipelines",
      },
      "/tmp/seqdesk-data"
    );

    expect(result.ready).toBe(true);
    expect(result.summary).toContain("Ready");
  });

  it("quickPrerequisiteCheck reports all failed components when everything is missing", async () => {
    fsAccessMock.mockRejectedValue(createFsError("ENOENT"));
    fsMkdirMock.mockRejectedValue(createFsError("EACCES"));

    execResponder = () => {
      return { error: createExecError("not found", "ENOENT") };
    };

    const result = await quickPrerequisiteCheck(
      {
        useSlurm: false,
        pipelineRunDir: "/tmp/seqdesk-runs",
      },
      "/tmp/missing-data"
    );

    expect(result.ready).toBe(false);
    expect(result.summary).toContain("Missing");
    expect(result.summary).toContain("Conda/Mamba");
  });

  it("checkAllPrerequisites summary reports warnings count", async () => {
    execResponder = (command: string) => {
      if (command === "which conda") {
        return { stdout: "/usr/bin/conda\n" };
      }
      if (command === "conda env list" || command === "'conda' env list") {
        return {
          stdout:
            "base * /opt/conda\nseqdesk-pipelines /opt/conda/envs/seqdesk-pipelines\n",
        };
      }
      if (command.includes("conda run -n seqdesk-pipelines nextflow -version")) {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command.includes("conda run -n seqdesk-pipelines java -version")) {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      if (command === "conda --version") {
        return { stdout: "conda 24.9.1\n" };
      }
      if (command.includes("create --yes --quiet --dry-run")) {
        return {
          error: createExecError(
            "network issue",
            "ETIMEOUT",
            "",
            "temporary failure in name resolution"
          ),
        };
      }
      if (command === "conda config --show channels") {
        return { stdout: "channels:\n  - defaults\n" };
      }
      if (command.includes("nf-core --version")) {
        return { error: createExecError("nf-core not found", "ENOENT") };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const result = await checkAllPrerequisites(
      {
        useSlurm: false,
        pipelineRunDir: "/tmp/seqdesk-runs",
        condaEnv: "seqdesk-pipelines",
      },
      "/tmp/seqdesk-data"
    );

    expect(result.requiredPassed).toBe(true);
    expect(result.allPassed).toBe(false);
    expect(result.summary).toMatch(/warning/i);
  });

  it("tests weblogUrl with an unexpected status code", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("server error", { status: 502 }));

    const result = await testSetting(
      "weblogUrl",
      "https://example.org/api/pipelines/weblog"
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("Unexpected response");
    expect(result.message).toContain("502");
    fetchSpy.mockRestore();
  });
});
