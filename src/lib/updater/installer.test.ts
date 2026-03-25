import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReleaseInfo } from "./types";

type ExecError = Error & { code?: string; stdout?: string; stderr?: string };
type ExecResponse = { stdout?: string; stderr?: string; error?: ExecError };
type ExecCallback = (error: ExecError | null, stdout?: string, stderr?: string) => void;

const mocks = vi.hoisted(() => ({
  execMock: vi.fn(),
  platformMock: vi.fn(),
  releaseUpdateLockMock: vi.fn(),
  requirePostgresDatabaseUrlMock: vi.fn(),
  loadInstalledDatabaseConfigMock: vi.fn(),
  getDatabaseCompatibilityErrorMock: vi.fn(),
}));

const {
  execMock,
  platformMock,
  releaseUpdateLockMock,
  requirePostgresDatabaseUrlMock,
  loadInstalledDatabaseConfigMock,
  getDatabaseCompatibilityErrorMock,
} = mocks;

vi.mock("child_process", () => ({
  exec: mocks.execMock,
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

vi.mock("os", () => ({
  default: {
    platform: mocks.platformMock,
    tmpdir: () => process.env.TMPDIR ?? "/tmp",
  },
  platform: mocks.platformMock,
  tmpdir: () => process.env.TMPDIR ?? "/tmp",
}));

vi.mock("./status", () => ({
  releaseUpdateLock: mocks.releaseUpdateLockMock,
}));

vi.mock("@/lib/database-url", () => ({
  requirePostgresDatabaseUrl: mocks.requirePostgresDatabaseUrlMock,
}));

vi.mock("./database-config", () => ({
  loadInstalledDatabaseConfig: mocks.loadInstalledDatabaseConfigMock,
  getDatabaseCompatibilityError: mocks.getDatabaseCompatibilityErrorMock,
}));

let cwd = "";
let tempDir = "";

let execResponder: (command: string, options?: unknown) => ExecResponse | Promise<ExecResponse>;

function createExecError(message: string, code?: string): ExecError {
  const error = new Error(message) as ExecError;
  if (code) {
    error.code = code;
  }
  return error;
}

function createRelease(overrides: Partial<ReleaseInfo> = {}): ReleaseInfo {
  return {
    version: "1.2.0",
    channel: "stable",
    releaseDate: "2026-03-24",
    downloadUrl: "https://example.com/seqdesk-1.2.0.tar.gz",
    checksum: "sha256:placeholder",
    releaseNotes: "Improved coverage",
    minNodeVersion: "20.0.0",
    ...overrides,
  };
}

async function loadInstallerModule() {
  vi.resetModules();
  return import("./installer");
}

async function seedInstallDir(): Promise<void> {
  await fs.mkdir(path.join(tempDir, "public"), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, "package.json"),
    JSON.stringify({ version: "1.1.80" }, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(tempDir, "seqdesk.config.json"),
    JSON.stringify(
      {
        runtime: {
          databaseUrl: "postgresql://preserved.example/seqdesk",
        },
      },
      null,
      2
    ),
    "utf8"
  );
  await fs.writeFile(path.join(tempDir, "server.js"), "console.log('old');\n", "utf8");
  await fs.writeFile(path.join(tempDir, "public", "old.txt"), "old\n", "utf8");
}

async function copyDirectoryContents(sourceDir: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  for (const entry of await fs.readdir(sourceDir)) {
    await fs.cp(path.join(sourceDir, entry), path.join(targetDir, entry), {
      recursive: true,
      force: true,
    });
  }
}

function configureInstallerShell(options: {
  extractedVersion?: string;
  restartMode?: "pm2" | "fallback";
  freeKB?: number;
} = {}): void {
  const {
    extractedVersion = "1.2.0",
    restartMode = "pm2",
    freeKB = 200 * 1024,
  } = options;

  execResponder = async (command: string, execOptions?: unknown) => {
    if (command.startsWith(`df -k "${tempDir}"`)) {
      return { stdout: `${freeKB}\n` };
    }

    const downloadMatch = command.match(/^curl -fsSL "(.+)" -o "(.+)"$/);
    if (downloadMatch) {
      await fs.writeFile(downloadMatch[2], "archive", "utf8");
      return { stdout: "" };
    }

    const extractMatch = command.match(/^tar -xzf "(.+)" -C "(.+)" --strip-components=1$/);
    if (extractMatch) {
      const extractDir = extractMatch[2];
      await fs.mkdir(path.join(extractDir, "public"), { recursive: true });
      await fs.writeFile(
        path.join(extractDir, "package.json"),
        JSON.stringify({ version: extractedVersion }, null, 2),
        "utf8"
      );
      await fs.writeFile(
        path.join(extractDir, "seqdesk.config.json"),
        JSON.stringify(
          {
            runtime: {
              databaseUrl: "postgresql://replacement.example/seqdesk",
            },
          },
          null,
          2
        ),
        "utf8"
      );
      await fs.writeFile(path.join(extractDir, "server.js"), "console.log('new');\n", "utf8");
      await fs.writeFile(path.join(extractDir, "public", "new.txt"), "new\n", "utf8");
      return { stdout: "" };
    }

    const copyMatch = command.match(/^cp -R "(.+)" "(.+)"$/);
    if (copyMatch) {
      const sourceDir = copyMatch[1].replace(/[\\/]\.$/, "");
      await copyDirectoryContents(sourceDir, copyMatch[2]);
      return { stdout: "" };
    }

    if (command === "node scripts/run-prisma.mjs migrate deploy") {
      expect(execOptions).toEqual({ cwd: tempDir });
      return { stdout: "" };
    }

    if (command === "pm2 restart seqdesk") {
      return restartMode === "pm2"
        ? { stdout: "" }
        : { error: createExecError("pm2 unavailable") };
    }

    if (command === "systemctl --user restart seqdesk") {
      return { error: createExecError("user service unavailable") };
    }

    if (command === "sudo -n systemctl restart seqdesk") {
      return { error: createExecError("sudo unavailable") };
    }

    return { error: createExecError(`Unhandled exec command: ${command}`) };
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  cwd = process.cwd();
  tempDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-installer-"))
  );
  process.chdir(tempDir);
  await seedInstallDir();

  execResponder = (command: string) => ({
    error: createExecError(`Unhandled exec command: ${command}`),
  });

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
      const options =
        typeof optionsOrCallback === "function" ? undefined : optionsOrCallback;

      if (!callback) {
        throw new Error("Missing exec callback");
      }

      Promise.resolve()
        .then(() => execResponder(String(command), options))
        .then((response) => {
          if (response.error) {
            callback(response.error, response.stdout ?? "", response.stderr ?? "");
            return;
          }
          callback(null, response.stdout ?? "", response.stderr ?? "");
        })
        .catch((error) => {
          callback(
            error instanceof Error ? (error as ExecError) : createExecError(String(error)),
            "",
            ""
          );
        });

      return {} as never;
    }
  );

  platformMock.mockReturnValue("linux");
  releaseUpdateLockMock.mockResolvedValue(undefined);
  requirePostgresDatabaseUrlMock.mockImplementation((value: string) => value);
  loadInstalledDatabaseConfigMock.mockResolvedValue({
    databaseUrl: "postgresql://installed.example/seqdesk",
    directUrl: null,
    provider: "postgresql",
  });
  getDatabaseCompatibilityErrorMock.mockReturnValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.chdir(cwd);
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("installer", () => {
  it("installs an update and preserves runtime configuration", async () => {
    configureInstallerShell();
    const progress: string[] = [];
    const mod = await loadInstallerModule();

    await mod.installUpdate(createRelease(), (entry) => {
      progress.push(`${entry.status}:${entry.progress}`);
    });

    await expect(fs.readFile(path.join(tempDir, "package.json"), "utf8")).resolves.toContain(
      '"version": "1.2.0"'
    );
    await expect(
      fs.readFile(path.join(tempDir, "seqdesk.config.json"), "utf8")
    ).resolves.toContain("preserved.example");
    await expect(fs.readFile(path.join(tempDir, "public", "new.txt"), "utf8")).resolves.toBe(
      "new\n"
    );
    await expect(fs.access(path.join(tempDir, ".update-temp"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    expect(progress).toEqual([
      "downloading:5",
      "downloading:10",
      "downloading:30",
      "extracting:40",
      "extracting:60",
      "extracting:80",
      "extracting:85",
      "extracting:90",
      "complete:100",
      "restarting:100",
    ]);
    expect(requirePostgresDatabaseUrlMock).toHaveBeenCalledWith(
      "postgresql://installed.example/seqdesk"
    );
    expect(releaseUpdateLockMock).toHaveBeenCalledTimes(1);
  });

  it("restores the previous install when version verification fails", async () => {
    configureInstallerShell({ extractedVersion: "1.1.99" });
    const progress: string[] = [];
    const mod = await loadInstallerModule();

    await expect(
      mod.installUpdate(createRelease(), (entry) => {
        progress.push(entry.status);
      })
    ).rejects.toThrow("Installed version check failed: Expected 1.2.0, found 1.1.99");

    await expect(fs.readFile(path.join(tempDir, "package.json"), "utf8")).resolves.toContain(
      '"version": "1.1.80"'
    );
    await expect(fs.readFile(path.join(tempDir, "public", "old.txt"), "utf8")).resolves.toBe(
      "old\n"
    );
    await expect(fs.access(path.join(tempDir, "public", "new.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    expect(progress.at(-1)).toBe("error");
    expect(releaseUpdateLockMock).toHaveBeenCalledTimes(1);
  });

  it("rejects updates when free disk space is too low", async () => {
    configureInstallerShell({ freeKB: 1024 });
    const progress: string[] = [];
    const mod = await loadInstallerModule();

    await expect(
      mod.installUpdate(createRelease(), (entry) => {
        progress.push(entry.status);
      })
    ).rejects.toThrow("Insufficient disk space");

    expect(progress).toEqual(["downloading", "error"]);
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(releaseUpdateLockMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to supervisor restart when restart commands are unavailable", async () => {
    configureInstallerShell({ restartMode: "fallback" });
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const mod = await loadInstallerModule();

    await mod.installUpdate(createRelease());

    expect(console.log).toHaveBeenCalledWith(
      "Update complete. Automatic restart command unavailable. Exiting for supervisor restart; if SeqDesk does not come back, restart it manually."
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(releaseUpdateLockMock).toHaveBeenCalledTimes(1);
  });

  it("fails checksum verification when the downloaded archive does not match", async () => {
    configureInstallerShell();
    const mod = await loadInstallerModule();

    await expect(
      mod.installUpdate(
        createRelease({
          checksum: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        })
      )
    ).rejects.toThrow("Checksum verification failed - download may be corrupted");

    expect(releaseUpdateLockMock).toHaveBeenCalledTimes(1);
  });
});
