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
  fsStatMock: vi.fn(),
  fsLstatMock: vi.fn(),
  fsRealpathMock: vi.fn(),
  fsMkdtempMock: vi.fn(),
  fsRmdirMock: vi.fn(),
  fsRmMock: vi.fn(),
  detectRuntimePlatformMock: vi.fn(),
  isMacOsArmRuntimeMock: vi.fn(),
}));

const {
  execMock,
  fsAccessMock,
  fsWriteFileMock,
  fsUnlinkMock,
  fsMkdirMock,
  fsStatMock,
  fsLstatMock,
  fsRealpathMock,
  fsMkdtempMock,
  fsRmdirMock,
  fsRmMock,
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
    stat: mocks.fsStatMock,
    lstat: mocks.fsLstatMock,
    realpath: mocks.fsRealpathMock,
    mkdtemp: mocks.fsMkdtempMock,
    rmdir: mocks.fsRmdirMock,
    rm: mocks.fsRmMock,
  },
  access: mocks.fsAccessMock,
  writeFile: mocks.fsWriteFileMock,
  unlink: mocks.fsUnlinkMock,
  mkdir: mocks.fsMkdirMock,
  stat: mocks.fsStatMock,
  lstat: mocks.fsLstatMock,
  realpath: mocks.fsRealpathMock,
  mkdtemp: mocks.fsMkdtempMock,
  rmdir: mocks.fsRmdirMock,
  rm: mocks.fsRmMock,
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
  checkPipelineRuntimePrerequisites,
  clearPipelineRuntimePrerequisiteCache,
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

function healthySlurmResponse(
  command: string,
  queueInfo = "cpu up\n"
): ExecResponse | null {
  if (
    /^(sinfo|sbatch|squeue|sacct|scontrol|scancel) --version$/.test(command)
  ) {
    return { stdout: "slurm 24.05.4\n" };
  }
  if (command.startsWith("sinfo -h ")) {
    return { stdout: queueInfo };
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearPipelineRuntimePrerequisiteCache();
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
  fsStatMock.mockResolvedValue({
    isDirectory: () => true,
  });
  fsLstatMock.mockResolvedValue({
    isSymbolicLink: () => false,
    isDirectory: () => true,
    isFile: () => true,
  });
  fsRealpathMock.mockImplementation(async (target: string) => String(target));
  fsMkdtempMock.mockImplementation(
    async (prefix: string) => `${String(prefix)}fixture`
  );
  fsRmdirMock.mockResolvedValue(undefined);
  fsRmMock.mockResolvedValue(undefined);

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
  it("checks Conda with Nextflow and Java for local pipeline readiness", async () => {
    execResponder = (command: string) => {
      if (command === "which conda") {
        return { stdout: "/usr/bin/conda\n" };
      }
      if (command === "conda env list") {
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
      if (command.includes("conda run -n seqdesk-pipelines java -version")) {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      if (command === "conda --version") {
        return { stdout: "conda 24.9.1\n" };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const settings = {
      useSlurm: false,
      pipelineRunDir: "/tmp/seqdesk-runs",
      condaEnv: "seqdesk-pipelines",
    };
    const [checks, inflightChecks] = await Promise.all([
      checkPipelineRuntimePrerequisites(settings),
      checkPipelineRuntimePrerequisites(settings),
    ]);
    const execCallCount = execMock.mock.calls.length;
    const cachedChecks = await checkPipelineRuntimePrerequisites(settings);

    expect(checks.map((check) => check.id)).toEqual([
      "nextflow",
      "java",
      "conda",
    ]);
    expect(checks.every((check) => check.status === "pass")).toBe(true);
    expect(inflightChecks).toBe(checks);
    expect(cachedChecks).toBe(checks);
    expect(execMock).toHaveBeenCalledTimes(execCallCount);
    expect(execMock).not.toHaveBeenCalledWith(
      expect.stringContaining("sinfo"),
      expect.anything(),
      expect.anything()
    );
  });

  it("blocks local readiness when run.sh would activate a missing Conda environment", async () => {
    execResponder = (command: string) => {
      if (command === "/opt/conda/condabin/conda --version") {
        return { stdout: "conda 24.9.1\n" };
      }
      if (command === "/opt/conda/condabin/conda env list") {
        return { stdout: "base * /opt/conda\n" };
      }
      if (command === "nextflow -version") {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command === "java -version 2>&1") {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const checks = await checkPipelineRuntimePrerequisites({
      useSlurm: false,
      pipelineRunDir: "/tmp/seqdesk-runs",
      condaPath: "/opt/conda",
      condaEnv: "missing-runtime",
    });

    expect(checks.find((check) => check.id === "nextflow")?.status).toBe(
      "pass"
    );
    expect(checks.find((check) => check.id === "java")?.status).toBe("pass");
    expect(checks.find((check) => check.id === "conda")).toEqual(
      expect.objectContaining({
        status: "fail",
        message:
          "Configured Conda environment not found: missing-runtime",
        details: expect.stringContaining(
          "Run scripts activate this environment"
        ),
      })
    );
  });

  it("keeps direct Nextflow ready when no Conda activation path is configured", async () => {
    execResponder = (command: string) => {
      if (command === "which conda") {
        return { stdout: "/usr/bin/conda\n" };
      }
      if (command === "conda env list") {
        return { stdout: "base * /opt/conda\n" };
      }
      if (command === "nextflow -version") {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command === "java -version 2>&1") {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      if (command === "conda --version") {
        return { stdout: "conda 24.9.1\n" };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const checks = await checkPipelineRuntimePrerequisites({
      useSlurm: false,
      pipelineRunDir: "/tmp/seqdesk-runs",
      condaPath: "   ",
      condaEnv: "missing-launcher-env",
    });

    expect(checks.every((check) => check.status === "pass")).toBe(true);
    expect(execMock).toHaveBeenCalledWith(
      "nextflow -version",
      expect.anything(),
      expect.anything()
    );
  });

  it("blocks local readiness when the configured Conda path lacks conda.sh", async () => {
    fsAccessMock.mockImplementation(async (target: string) => {
      if (String(target) === "/opt/conda/etc/profile.d/conda.sh") {
        throw createFsError("ENOENT");
      }
    });
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
      if (command.includes(
        "/opt/conda/condabin/conda run -n seqdesk-pipelines nextflow -version"
      )) {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command.includes(
        "/opt/conda/condabin/conda run -n seqdesk-pipelines java -version"
      )) {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const checks = await checkPipelineRuntimePrerequisites({
      useSlurm: false,
      pipelineRunDir: "/tmp/seqdesk-runs",
      condaPath: "/opt/conda",
      condaEnv: "seqdesk-pipelines",
    });

    expect(checks.find((check) => check.id === "conda")).toEqual(
      expect.objectContaining({
        status: "fail",
        message: "Configured Conda runtime cannot be initialized",
        details: expect.stringContaining(
          "/opt/conda/etc/profile.d/conda.sh"
        ),
      })
    );
  });

  it("fails closed when the strict bootstrap hits an unbound init variable", async () => {
    execResponder = (command: string) => {
      if (command === "/opt/conda/condabin/conda --version") {
        return { stdout: "conda 24.9.1\n" };
      }
      if (command === "/opt/conda/condabin/conda env list") {
        return {
          stdout:
            "base * /opt/conda\nbroken-runtime /opt/conda/envs/broken-runtime\n",
        };
      }
      if (command.includes(
        "/opt/conda/condabin/conda run -n broken-runtime nextflow -version"
      )) {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command.includes(
        "/opt/conda/condabin/conda run -n broken-runtime java -version"
      )) {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      if (
        command.startsWith("/bin/bash -c ") &&
        command.includes("set -euo pipefail") &&
        command.includes('export CONDA_BASE="$1"') &&
        command.includes('export PATH="$CONDA_BASE/bin:$PATH"') &&
        command.endsWith(
          " /opt/conda /opt/conda/etc/profile.d/conda.sh broken-runtime"
        )
      ) {
        return {
          error: createExecError(
            "strict activation failed",
            "EACCES",
            "",
            "conda.sh: UNBOUND_RUNTIME: unbound variable"
          ),
        };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const checks = await checkPipelineRuntimePrerequisites({
      useSlurm: false,
      pipelineRunDir: "/tmp/seqdesk-runs",
      condaPath: "/opt/conda",
      condaEnv: "broken-runtime",
    });

    expect(checks.find((check) => check.id === "conda")).toEqual(
      expect.objectContaining({
        status: "fail",
        message:
          "Configured Conda environment cannot be activated: broken-runtime",
        details: expect.stringContaining("unbound variable"),
      })
    );
    expect(execMock).toHaveBeenCalledWith(
      expect.stringContaining("set -euo pipefail"),
      expect.anything(),
      expect.anything()
    );
  });

  it("quotes paths and supplies the executor CONDA_BASE/PATH context", async () => {
    const condaPath = "/opt/SeqDesk Conda";
    const condaBin = `${condaPath}/condabin/conda`;
    const condaInit = `${condaPath}/etc/profile.d/conda.sh`;
    const quotedCondaBin = `'${condaBin}'`;

    execResponder = (command: string) => {
      if (command === `${quotedCondaBin} --version`) {
        return { stdout: "conda 24.9.1\n" };
      }
      if (command === `${quotedCondaBin} env list`) {
        return {
          stdout:
            `base * ${condaPath}\n` +
            `seqdesk-pipelines ${condaPath}/envs/seqdesk-pipelines\n`,
        };
      }
      if (command.includes(
        `${quotedCondaBin} run -n seqdesk-pipelines nextflow -version`
      )) {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command.includes(
        `${quotedCondaBin} run -n seqdesk-pipelines java -version`
      )) {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      if (
        command ===
        `/bin/bash -c 'set -euo pipefail; export CONDA_BASE="$1"; ` +
          `CONDA_SH="$2"; CONDA_ENV="$3"; ` +
          `export PATH="$CONDA_BASE/bin:$PATH"; source "$CONDA_SH"; ` +
          `conda activate "$CONDA_ENV"; conda --version' ` +
          `seqdesk-conda-readiness '${condaPath}' '${condaInit}' ` +
          `seqdesk-pipelines`
      ) {
        return { stdout: "conda 24.9.1\n" };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const checks = await checkPipelineRuntimePrerequisites({
      useSlurm: false,
      pipelineRunDir: "/tmp/seqdesk-runs",
      condaPath,
      condaEnv: "seqdesk-pipelines",
    });

    expect(checks.every((check) => check.status === "pass")).toBe(true);
    expect(execMock).toHaveBeenCalledWith(
      `${quotedCondaBin} --version`,
      expect.anything(),
      expect.anything()
    );
    expect(execMock).toHaveBeenCalledWith(
      expect.stringContaining(`'${condaInit}'`),
      expect.anything(),
      expect.anything()
    );
  });

  it("does not accept a mamba-only path that run.sh cannot activate", async () => {
    fsAccessMock.mockImplementation(async (target: string) => {
      const candidate = String(target);
      if (candidate.endsWith("/conda")) {
        throw createFsError("ENOENT");
      }
    });
    execResponder = (command: string) => {
      if (command === "/opt/mamba/condabin/mamba --version") {
        return { stdout: "mamba 2.0.5\n" };
      }
      if (command === "which conda") {
        return { error: createExecError("conda not found", "ENOENT") };
      }
      if (command === "nextflow -version") {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command === "java -version 2>&1") {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const checks = await checkPipelineRuntimePrerequisites({
      useSlurm: false,
      pipelineRunDir: "/tmp/seqdesk-runs",
      condaPath: "/opt/mamba",
      condaEnv: "seqdesk-pipelines",
    });

    expect(checks.find((check) => check.id === "conda")).toEqual(
      expect.objectContaining({
        status: "fail",
        message: "Configured Conda runtime cannot be initialized",
        details: expect.stringContaining("/opt/mamba/condabin/conda"),
      })
    );
    expect(execMock).not.toHaveBeenCalledWith(
      "/opt/mamba/condabin/mamba --version",
      expect.anything(),
      expect.anything()
    );
  });

  it("does not mark a local Mamba-only host as ready", async () => {
    execResponder = (command: string) => {
      if (command === "which conda" || command === "conda --version") {
        return { error: createExecError("conda not found", "ENOENT") };
      }
      if (command === "mamba --version") {
        return { stdout: "mamba 2.0.5\n" };
      }
      if (command === "nextflow -version") {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command === "java -version 2>&1") {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const checks = await checkPipelineRuntimePrerequisites({
      useSlurm: false,
      pipelineRunDir: "/tmp/seqdesk-runs",
    });

    expect(checks.find((check) => check.id === "conda")).toEqual(
      expect.objectContaining({
        name: "Conda",
        status: "fail",
        message: "Conda not found",
        details: expect.stringContaining("Mamba-only runtime is not supported"),
      })
    );
    expect(execMock).not.toHaveBeenCalledWith(
      "mamba --version",
      expect.anything(),
      expect.anything()
    );
  });

  it("uses a Conda prefix selector for a shared pipeline environment", async () => {
    const environment = "/shared/conda/envs/seqdesk-pipelines";
    execResponder = (command: string) => {
      if (command === "which conda") {
        return { stdout: "/usr/bin/conda\n" };
      }
      if (
        command.includes(
          `conda run -p ${environment} nextflow -version`
        )
      ) {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (
        command.includes(`conda run -p ${environment} java -version`)
      ) {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      if (command === "conda --version") {
        return { stdout: "conda 24.9.1\n" };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const checks = await checkPipelineRuntimePrerequisites({
      useSlurm: false,
      pipelineRunDir: "/tmp/seqdesk-runs",
      condaEnv: environment,
    });

    expect(checks.every((check) => check.status === "pass")).toBe(true);
    expect(execMock).toHaveBeenCalledWith(
      expect.stringContaining(`run -p ${environment} nextflow -version`),
      expect.anything(),
      expect.anything()
    );
  });

  it("rejects Java versions older than the documented Java 17 runtime", async () => {
    execResponder = (command: string) => {
      if (command === "which conda") {
        return { stdout: "/usr/bin/conda\n" };
      }
      if (command === "conda env list") {
        return {
          stdout:
            "base * /opt/conda\nseqdesk-pipelines /opt/conda/envs/seqdesk-pipelines\n",
        };
      }
      if (command.includes("conda run -n seqdesk-pipelines nextflow -version")) {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command.includes("conda run -n seqdesk-pipelines java -version")) {
        return { stderr: 'openjdk version "11.0.24"\n' };
      }
      if (command === "conda --version") {
        return { stdout: "conda 24.9.1\n" };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const checks = await checkPipelineRuntimePrerequisites({
      useSlurm: false,
      pipelineRunDir: "/tmp/seqdesk-runs",
    });

    expect(checks.find((check) => check.id === "java")).toEqual(
      expect.objectContaining({
        status: "warning",
        message: expect.stringContaining("17+ required"),
      })
    );
  });

  it("requires both SLURM and Conda for scheduler pipeline readiness", async () => {
    execResponder = (command: string) => {
      const slurmResponse = healthySlurmResponse(command);
      if (slurmResponse) return slurmResponse;
      if (command === "which conda" || command === "conda --version") {
        return { error: createExecError("conda not found", "ENOENT") };
      }
      if (command === "nextflow -version") {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command === "java -version 2>&1") {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const checks = await checkPipelineRuntimePrerequisites({
      useSlurm: true,
      pipelineRunDir: "/tmp/seqdesk-runs",
      condaPath: "   ",
    });

    expect(checks.map((check) => check.id)).toEqual([
      "nextflow",
      "java",
      "slurm",
      "conda",
    ]);
    expect(checks.find((check) => check.id === "slurm")?.status).toBe("pass");
    expect(checks.find((check) => check.id === "conda")).toEqual(
      expect.objectContaining({
        required: true,
        status: "fail",
        message: "Conda not found",
      })
    );
    expect(execMock).toHaveBeenCalledWith(
      "conda --version",
      expect.anything(),
      expect.anything()
    );
  });

  it("blocks SLURM readiness when its configured Conda environment is missing", async () => {
    execResponder = (command: string) => {
      const slurmResponse = healthySlurmResponse(command);
      if (slurmResponse) return slurmResponse;
      if (command === "/opt/conda/condabin/conda --version") {
        return { stdout: "conda 24.9.1\n" };
      }
      if (command === "/opt/conda/condabin/conda env list") {
        return { stdout: "base * /opt/conda\n" };
      }
      if (command === "nextflow -version") {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command === "java -version 2>&1") {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const checks = await checkPipelineRuntimePrerequisites({
      useSlurm: true,
      pipelineRunDir: "/tmp/seqdesk-runs",
      condaPath: "/opt/conda",
      condaEnv: "missing-slurm-runtime",
    });

    expect(checks.map((check) => check.id)).toEqual([
      "nextflow",
      "java",
      "slurm",
      "conda",
    ]);
    expect(checks.find((check) => check.id === "slurm")?.status).toBe("pass");
    expect(checks.find((check) => check.id === "nextflow")?.status).toBe(
      "pass"
    );
    expect(checks.find((check) => check.id === "java")?.status).toBe("pass");
    expect(checks.find((check) => check.id === "conda")).toEqual(
      expect.objectContaining({
        required: true,
        status: "fail",
        message:
          "Configured Conda environment not found: missing-slurm-runtime",
      })
    );
  });

  it("fails SLURM readiness when an operational command is missing", async () => {
    execResponder = (command: string) => {
      const slurmResponse = healthySlurmResponse(command);
      if (slurmResponse && command !== "sacct --version") {
        return slurmResponse;
      }
      if (command === "which conda") {
        return { error: createExecError("conda not found", "ENOENT") };
      }
      if (command === "nextflow -version") {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command === "java -version 2>&1") {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      return { error: createExecError(`missing: ${command}`, "ENOENT") };
    };

    const checks = await checkPipelineRuntimePrerequisites({
      useSlurm: true,
      pipelineRunDir: "/tmp/seqdesk-runs",
    });

    expect(checks.find((check) => check.id === "slurm")).toEqual(
      expect.objectContaining({
        status: "fail",
        details: expect.stringContaining("sacct"),
      })
    );
  });

  it("fails SLURM readiness when scontrol host resolution is unavailable", async () => {
    execResponder = (command: string) => {
      const slurmResponse = healthySlurmResponse(command);
      if (slurmResponse && command !== "scontrol --version") {
        return slurmResponse;
      }
      if (command === "which conda") {
        return { error: createExecError("conda not found", "ENOENT") };
      }
      if (command === "nextflow -version") {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command === "java -version 2>&1") {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      return { error: createExecError(`missing: ${command}`, "ENOENT") };
    };

    const checks = await checkPipelineRuntimePrerequisites({
      useSlurm: true,
      pipelineRunDir: "/tmp/seqdesk-runs",
    });

    expect(checks.find((check) => check.id === "slurm")).toEqual(
      expect.objectContaining({
        status: "fail",
        details: expect.stringContaining("scontrol"),
      })
    );
  });

  it("checks the configured SLURM partition", async () => {
    execResponder = (command: string) => {
      const slurmResponse = healthySlurmResponse(command, "reviewer* up\n");
      if (slurmResponse) return slurmResponse;
      if (command === "which conda") {
        return { error: createExecError("conda not found", "ENOENT") };
      }
      if (command === "nextflow -version") {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command === "java -version 2>&1") {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const checks = await checkPipelineRuntimePrerequisites({
      useSlurm: true,
      slurmQueue: "reviewer",
      pipelineRunDir: "/tmp/seqdesk-runs",
    });

    expect(checks.find((check) => check.id === "slurm")).toEqual(
      expect.objectContaining({
        status: "pass",
        message: "Partition reviewer is available",
      })
    );
    expect(execMock).toHaveBeenCalledWith(
      'sinfo -h -p reviewer -o "%P %a"',
      expect.anything(),
      expect.anything()
    );
  });

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
    expect(fsMkdtempMock).toHaveBeenCalledWith(
      "/tmp/seqdesk-runs/.seqdesk-readiness-"
    );
    expect(fsWriteFileMock).toHaveBeenCalledWith(
      "/tmp/seqdesk-runs/.seqdesk-readiness-fixture/write-probe",
      "seqdesk readiness\n",
      {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      }
    );
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
    expect(result.summary).toContain("Conda");

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
    expect(result.summary).toContain("Conda");
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

  it("rejects a regular file configured as pipelineRunDir", async () => {
    fsLstatMock.mockImplementation(async (target: string) => {
      if (String(target) === "/tmp/not-a-directory") {
        return {
          isSymbolicLink: () => false,
          isDirectory: () => false,
          isFile: () => true,
        };
      }
      return {
        isSymbolicLink: () => false,
        isDirectory: () => true,
        isFile: () => true,
      };
    });

    const result = await testSetting(
      "pipelineRunDir",
      "/tmp/not-a-directory"
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        message: "Configured path is not a directory",
      })
    );
    expect(fsMkdtempMock).not.toHaveBeenCalled();
  });

  it("accepts a pipelineRunDir symlink to a writable directory", async () => {
    fsLstatMock.mockImplementation(async (target: string) => {
      if (String(target) === "/srv/seqdesk-runs") {
        return {
          isSymbolicLink: () => true,
          isDirectory: () => false,
          isFile: () => false,
        };
      }
      return {
        isSymbolicLink: () => false,
        isDirectory: () => true,
        isFile: () => true,
      };
    });
    fsRealpathMock.mockImplementation(async (target: string) =>
      String(target) === "/srv/seqdesk-runs"
        ? "/mnt/shared/seqdesk-runs"
        : String(target)
    );

    const result = await testSetting(
      "pipelineRunDir",
      "/srv/seqdesk-runs"
    );

    expect(result.success).toBe(true);
    expect(fsMkdtempMock).toHaveBeenCalledWith(
      "/mnt/shared/seqdesk-runs/.seqdesk-readiness-"
    );
  });

  it("rejects the filesystem root as pipelineRunDir", async () => {
    fsRealpathMock.mockResolvedValue("/");

    const result = await testSetting("pipelineRunDir", "/");

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        message: "Filesystem root cannot be used",
      })
    );
    expect(fsMkdtempMock).not.toHaveBeenCalled();
  });

  it("fails if a pipelineRunDir symlink retargets during the write probe", async () => {
    let rootResolutionCount = 0;
    fsLstatMock.mockImplementation(async (target: string) => {
      if (String(target) === "/srv/seqdesk-runs") {
        return {
          isSymbolicLink: () => true,
          isDirectory: () => false,
          isFile: () => false,
        };
      }
      return {
        isSymbolicLink: () => false,
        isDirectory: () => true,
        isFile: () => true,
      };
    });
    fsRealpathMock.mockImplementation(async (target: string) => {
      if (String(target) === "/srv/seqdesk-runs") {
        rootResolutionCount += 1;
        return rootResolutionCount === 1
          ? "/mnt/shared/seqdesk-runs-a"
          : "/mnt/shared/seqdesk-runs-b";
      }
      return String(target);
    });

    const result = await testSetting(
      "pipelineRunDir",
      "/srv/seqdesk-runs"
    );

    expect(result.success).toBe(false);
    expect(rootResolutionCount).toBe(2);
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
      const slurmResponse = healthySlurmResponse(command, "normal* up\n");
      if (slurmResponse) return slurmResponse;
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
      const slurmResponse = healthySlurmResponse(command, "normal* up\n");
      if (slurmResponse) return slurmResponse;
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

  it("does not report SLURM ready when Conda is missing", async () => {
    execResponder = (command: string) => {
      const slurmResponse = healthySlurmResponse(command, "cpu* up\n");
      if (slurmResponse) return slurmResponse;
      if (command === "nextflow -version") {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command === "java -version 2>&1") {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      return { error: createExecError(`not available: ${command}`, "ENOENT") };
    };

    const result = await checkAllPrerequisites(
      {
        useSlurm: true,
        slurmQueue: "cpu",
        pipelineRunDir: "/tmp/seqdesk-runs",
        condaPath: "   ",
      },
      "/tmp/seqdesk-data"
    );

    expect(result.requiredPassed).toBe(false);
    expect(result.checks.find((check) => check.id === "conda")).toEqual(
      expect.objectContaining({
        required: true,
        status: "fail",
      })
    );
    expect(result.summary).toContain("Missing required: Conda");
  });

  it("requires an explicitly configured Conda runtime for full SLURM readiness", async () => {
    execResponder = (command: string) => {
      const slurmResponse = healthySlurmResponse(command, "cpu* up\n");
      if (slurmResponse) return slurmResponse;
      if (command === "/opt/conda/condabin/conda --version") {
        return { stdout: "conda 24.9.1\n" };
      }
      if (command === "/opt/conda/condabin/conda env list") {
        return { stdout: "base * /opt/conda\n" };
      }
      if (command === "nextflow -version") {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command === "java -version 2>&1") {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      if (command.includes("create --yes --quiet --dry-run")) {
        return { stdout: "Dry run complete\n" };
      }
      if (command === "/opt/conda/condabin/conda config --show channels") {
        return { stdout: "channels:\n  - conda-forge\n  - bioconda\n" };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const result = await checkAllPrerequisites(
      {
        useSlurm: true,
        slurmQueue: "cpu",
        pipelineRunDir: "/tmp/seqdesk-runs",
        condaPath: "/opt/conda",
        condaEnv: "missing-slurm-runtime",
      },
      "/tmp/seqdesk-data"
    );

    expect(result.requiredPassed).toBe(false);
    expect(result.summary).toContain("Conda");
    expect(result.checks.find((check) => check.id === "conda")).toEqual(
      expect.objectContaining({
        required: true,
        status: "fail",
        message:
          "Configured Conda environment not found: missing-slurm-runtime",
      })
    );
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
      if (command.includes("conda run -n seqdesk-pipelines java -version")) {
        return { stderr: 'openjdk version "17.0.9"\n' };
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

  it("quickPrerequisiteCheck rejects a regular file as the data base path", async () => {
    fsStatMock.mockImplementation(async (target: string) => ({
      isDirectory: () => String(target) !== "/tmp/seqdesk-data-file",
    }));
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
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const result = await quickPrerequisiteCheck(
      {
        useSlurm: false,
        pipelineRunDir: "/tmp/seqdesk-runs",
        condaEnv: "seqdesk-pipelines",
      },
      "/tmp/seqdesk-data-file"
    );

    expect(result.ready).toBe(false);
    expect(result.summary).toContain("Data Base Path");
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
    expect(result.summary).toContain("Conda");
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

  it("tests pipelineRunDir with a path that needs creation", async () => {
    let pathChecked = false;
    fsLstatMock.mockImplementation(async (target: string) => {
      if (String(target) === "/tmp/new-dir" && !pathChecked) {
        pathChecked = true;
        throw createFsError("ENOENT");
      }
      return {
        isSymbolicLink: () => false,
        isDirectory: () => true,
        isFile: () => true,
      };
    });
    fsMkdirMock.mockResolvedValue(undefined);

    const result = await testSetting("pipelineRunDir", "/tmp/new-dir");
    expect(result.success).toBe(true);
    expect(fsMkdirMock).toHaveBeenCalledWith("/tmp/new-dir", {
      recursive: true,
    });
  });

  it("tests pipelineRunDir with a write error", async () => {
    fsAccessMock.mockResolvedValue(undefined);
    const permError = createFsError("EACCES");
    fsWriteFileMock.mockRejectedValue(permError);

    const result = await testSetting("pipelineRunDir", "/root/forbidden");
    expect(result.success).toBe(false);
  });

  it("tests condaPath with a specific path finds conda in condabin", async () => {
    fsAccessMock.mockImplementation(async (target: string) => {
      if (String(target) === "/opt/miniconda/bin/conda") {
        throw createFsError("ENOENT");
      }
      // condabin/conda passes
    });

    execResponder = (command: string) => {
      if (command === "/opt/miniconda/condabin/conda --version") {
        return { stdout: "conda 24.7.0\n" };
      }
      if (command.includes("create --yes --quiet --dry-run")) {
        return { stdout: "Dry run complete\n" };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const result = await testSetting("condaPath", "/opt/miniconda");
    expect(result.success).toBe(true);
    expect(result.version).toBe("conda 24.7.0");
  });

  it("tests slurm when sinfo is not available", async () => {
    execResponder = () => {
      return { error: createExecError("not found", "ENOENT") };
    };

    const result = await testSetting("slurm");
    expect(result.success).toBe(false);
    expect(result.message).toContain("Not available");
  });

  it("tests nfcore when not installed reports not found", async () => {
    execResponder = (command: string) => {
      if (command === "which conda") {
        return { error: createExecError("not found", "ENOENT") };
      }
      if (command === "nf-core --version 2>&1") {
        return { error: createExecError("nf-core not found", "ENOENT") };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const result = await testSetting("nfcore");
    expect(result.success).toBe(false);
    expect(result.message).toContain("Not installed");
  });

  it("tests nextflow when command returns unexpected output", async () => {
    execResponder = (command: string) => {
      if (command === "nextflow -version") {
        return { stdout: "some unexpected output\n" };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const result = await testSetting("nextflow");
    expect(result.success).toBe(true);
    expect(result.version).toBeUndefined();
  });

  it("detects tool versions returning partial data when some tools fail", async () => {
    execResponder = (command: string) => {
      if (command === "conda --version") {
        return { stdout: "conda 24.9.1\n" };
      }
      if (command === "conda env list") {
        return { stdout: "base * /opt/conda\n" };
      }
      if (command === "nextflow -version") {
        return { stdout: "nextflow version 24.10.0.5000\n" };
      }
      if (command === "nf-core --version") {
        return { error: createExecError("not found", "ENOENT") };
      }
      if (command === "java -version 2>&1") {
        return { error: createExecError("not found", "ENOENT") };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const versions = await detectVersions();
    expect(versions.conda).toBe("24.9.1");
    expect(versions.nextflow).toBe("24.10.0");
    expect(versions.nfcore).toBeUndefined();
    expect(versions.java).toBeUndefined();
  });

  it("checkAllPrerequisites run dir creation on ENOENT", async () => {
    let pathChecked = false;
    fsLstatMock.mockImplementation(async (target: string) => {
      if (String(target) === "/tmp/nonexistent-dir" && !pathChecked) {
        pathChecked = true;
        throw createFsError("ENOENT");
      }
      return {
        isSymbolicLink: () => false,
        isDirectory: () => true,
        isFile: () => true,
      };
    });

    execResponder = (command: string) => {
      if (command === "which conda") {
        return { stdout: "/usr/bin/conda\n" };
      }
      if (command === "conda env list" || command === "'conda' env list") {
        return {
          stdout: "base * /opt/conda\nseqdesk-pipelines /opt/conda/envs/seqdesk-pipelines\n",
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
        pipelineRunDir: "/tmp/nonexistent-dir",
        condaEnv: "seqdesk-pipelines",
      },
      "/tmp/seqdesk-data"
    );

    const runDirCheck = result.checks.find((c) => c.id === "run_directory");
    expect(runDirCheck?.status).toBe("pass");
    expect(runDirCheck?.message).toContain("Created");
  });

  it("checkConda accepts a condabin-only install at the configured root", async () => {
    // Miniconda/Mambaforge layout: only <root>/condabin/conda exists, not <root>/bin/conda.
    fsAccessMock.mockImplementation(async (target: string) => {
      const value = String(target);
      if (value.startsWith("/opt/miniconda/bin/")) {
        throw createFsError("ENOENT");
      }
      // condabin candidates, run dir, and data base path all resolve.
    });

    execResponder = (command: string) => {
      if (command === "/opt/miniconda/condabin/conda --version") {
        return { stdout: "conda 24.7.0\n" };
      }
      if (command === "/opt/miniconda/condabin/conda env list") {
        return {
          stdout:
            "base * /opt/miniconda\nseqdesk-pipelines /opt/miniconda/envs/seqdesk-pipelines\n",
        };
      }
      if (command.includes("run -n seqdesk-pipelines nextflow -version")) {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command.includes("run -n seqdesk-pipelines java -version")) {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      if (command.includes("create --yes --quiet --dry-run")) {
        return { stdout: "Dry run complete\n" };
      }
      if (command.includes("config --show channels")) {
        return { stdout: "channels:\n  - conda-forge\n  - bioconda\n" };
      }
      if (command.includes("nf-core --version")) {
        return { stdout: "nf-core, version 2.14.1\n" };
      }
      if (
        command.startsWith("/bin/bash -c ") &&
        command.includes(
          "seqdesk-conda-readiness /opt/miniconda /opt/miniconda/etc/profile.d/conda.sh seqdesk-pipelines"
        )
      ) {
        return { stdout: "conda 24.7.0\n" };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const result = await checkAllPrerequisites(
      {
        useSlurm: false,
        condaPath: "/opt/miniconda",
        pipelineRunDir: "/tmp/seqdesk-runs",
        condaEnv: "seqdesk-pipelines",
      },
      "/tmp/seqdesk-data"
    );

    const condaCheck = result.checks.find((c) => c.id === "conda");
    expect(condaCheck?.status).toBe("pass");
    expect(condaCheck?.message).toBe("Found at configured path");
    expect(result.requiredPassed).toBe(true);
  });

  it("does not treat a substring-only conda env name as the configured env", async () => {
    // Host has seqdesk-pipelines-backup but not the exact seqdesk-pipelines env.
    // Java/Nextflow detection must NOT use `conda run -n seqdesk-pipelines`.
    execResponder = (command: string) => {
      if (command === "which conda") {
        return { stdout: "/usr/bin/conda\n" };
      }
      if (command === "conda env list" || command === "'conda' env list") {
        return {
          stdout:
            "base * /opt/conda\nseqdesk-pipelines-backup /opt/conda/envs/seqdesk-pipelines-backup\n",
        };
      }
      // System PATH fallbacks (used because the exact env does not exist).
      if (command === "nextflow -version") {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command === "java -version 2>&1") {
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
      if (command === "nf-core --version 2>&1" || command.includes("nf-core --version")) {
        return { stdout: "nf-core, version 2.14.1\n" };
      }
      // Any `conda run -n seqdesk-pipelines ...` would fall through to here and fail,
      // proving the substring match did not trigger.
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

    const javaCheck = result.checks.find((c) => c.id === "java");
    // Detected via system PATH, not the (non-existent) exact conda env.
    expect(javaCheck?.status).toBe("pass");
    expect(javaCheck?.message).toBe("Installed (Java 17)");

    const nextflowCheck = result.checks.find((c) => c.id === "nextflow");
    expect(nextflowCheck?.status).toBe("pass");
    expect(nextflowCheck?.message).not.toContain("conda env");

    const versions = await detectVersions(undefined, "seqdesk-pipelines");
    // condaEnv must be absent because the exact env name does not exist.
    expect(versions.condaEnv).toBeUndefined();
  });

  it("quickPrerequisiteCheck requires Conda in addition to SLURM and Java", async () => {
    execResponder = (command: string) => {
      const slurmResponse = healthySlurmResponse(command, "normal* up\n");
      if (slurmResponse) return slurmResponse;
      if (command === "which conda" || command === "conda --version") {
        return { error: createExecError("conda not found", "ENOENT") };
      }
      if (command === "nextflow -version") {
        return { stdout: "nextflow version 24.10.0.5934\n" };
      }
      if (command === "java -version 2>&1") {
        return { stderr: 'openjdk version "17.0.9"\n' };
      }
      return { error: createExecError(`Unhandled command: ${command}`) };
    };

    const result = await quickPrerequisiteCheck(
      {
        useSlurm: true,
        pipelineRunDir: "/tmp/seqdesk-runs",
        condaEnv: "seqdesk-pipelines",
      },
      "/tmp/seqdesk-data"
    );

    expect(result.ready).toBe(false);
    expect(result.summary).toContain("Conda");
  });
});
