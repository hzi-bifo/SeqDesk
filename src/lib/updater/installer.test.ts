import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReleaseInfo } from "./types";

type ExecError = Error & { code?: string; stdout?: string; stderr?: string };
type ExecResponse = { stdout?: string; stderr?: string; error?: ExecError };
type ExecCallback = (error: ExecError | null, stdout?: string, stderr?: string) => void;

const UPDATE_COMMAND_MAX_BUFFER = 128 * 1024 * 1024;

const mocks = vi.hoisted(() => ({
  execMock: vi.fn(),
  platformMock: vi.fn(),
  releaseUpdateLockMock: vi.fn(),
  readUpdateStateMock: vi.fn(),
  writeUpdateStateMock: vi.fn(),
  patchUpdateStateMock: vi.fn(),
  requirePostgresDatabaseUrlMock: vi.fn(),
  loadInstalledDatabaseConfigMock: vi.fn(),
  getDatabaseCompatibilityErrorMock: vi.fn(),
  dbMock: {
    order: { count: vi.fn() },
    sample: { count: vi.fn() },
    study: { count: vi.fn() },
    user: { count: vi.fn() },
  },
}));

const {
  execMock,
  platformMock,
  releaseUpdateLockMock,
  readUpdateStateMock,
  writeUpdateStateMock,
  patchUpdateStateMock,
  requirePostgresDatabaseUrlMock,
  loadInstalledDatabaseConfigMock,
  getDatabaseCompatibilityErrorMock,
} = mocks;

vi.mock("@/lib/db", () => ({
  db: mocks.dbMock,
}));

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
  patchUpdateState: mocks.patchUpdateStateMock,
  readUpdateState: mocks.readUpdateStateMock,
  releaseUpdateLock: mocks.releaseUpdateLockMock,
  writeUpdateState: mocks.writeUpdateStateMock,
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
  await fs.mkdir(path.join(tempDir, "pipelines", "metaxpath"), { recursive: true });
  await fs.mkdir(path.join(tempDir, "scripts"), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, "package.json"),
    JSON.stringify({ version: "1.1.80" }, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(tempDir, "package-lock.json"),
    JSON.stringify({ name: "seqdesk", version: "1.1.80", lockfileVersion: 3 }, null, 2),
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
  await fs.writeFile(
    path.join(tempDir, "pipelines", "metaxpath", "manifest.json"),
    JSON.stringify({ id: "metaxpath", source: "private-installed" }, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(tempDir, "scripts", "apply-install-profile.mjs"),
    "console.log('old profile applicator');\n",
    "utf8"
  );
}

async function seedReleaseLayout(version = "1.1.80"): Promise<string> {
  const releaseDir = path.join(tempDir, "releases", version);
  await fs.mkdir(releaseDir, { recursive: true });
  await fs.writeFile(
    path.join(releaseDir, "package.json"),
    JSON.stringify({ version }, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(releaseDir, "package-lock.json"),
    JSON.stringify({ name: "seqdesk", version, lockfileVersion: 3 }, null, 2),
    "utf8"
  );
  await fs.writeFile(path.join(releaseDir, "server.js"), "console.log('release');\n", "utf8");
  await fs.writeFile(path.join(releaseDir, "start.sh"), "#!/usr/bin/env bash\nnode server.js\n", "utf8");
  await fs.symlink(path.join(tempDir, "seqdesk.config.json"), path.join(releaseDir, "seqdesk.config.json"), "file");
  await fs.symlink(path.join(tempDir, "data"), path.join(releaseDir, "data"), "dir");
  await fs.symlink(path.join(tempDir, "pipelines"), path.join(releaseDir, "pipelines"), "dir");
  await fs.mkdir(path.join(tempDir, "pipeline_runs"), { recursive: true });
  await fs.symlink(path.join(tempDir, "pipeline_runs"), path.join(releaseDir, "pipeline_runs"), "dir");
  await fs.symlink(path.join("releases", version), path.join(tempDir, "current"), "dir");
  await fs.writeFile(
    path.join(tempDir, "start.sh"),
    '#!/usr/bin/env bash\ncd "$(dirname "$0")/current"\nexec ./start.sh "$@"\n',
    "utf8"
  );
  return releaseDir;
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

function expectUpdateExecOptions(execOptions: unknown): string {
  const options = execOptions as { cwd?: string; maxBuffer?: number };
  expect(options).toEqual(expect.objectContaining({ maxBuffer: UPDATE_COMMAND_MAX_BUFFER }));
  if (options.cwd) {
    expect(path.resolve(options.cwd).startsWith(tempDir)).toBe(true);
  }
  return options.cwd || tempDir;
}

function configureInstallerShell(options: {
  extractedVersion?: string;
  includeExtractedLockfile?: boolean;
  restartMode?: "pm2" | "fallback";
  freeKB?: number;
} = {}): void {
  const {
    extractedVersion = "1.2.0",
    includeExtractedLockfile = true,
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
      await fs.mkdir(path.join(extractDir, "pipelines", "fastqc"), { recursive: true });
      await fs.mkdir(path.join(extractDir, "scripts"), { recursive: true });
      await fs.writeFile(
        path.join(extractDir, "package.json"),
        JSON.stringify({ version: extractedVersion }, null, 2),
        "utf8"
      );
      if (includeExtractedLockfile) {
        await fs.writeFile(
          path.join(extractDir, "package-lock.json"),
          JSON.stringify({ name: "seqdesk", version: extractedVersion, lockfileVersion: 3 }, null, 2),
          "utf8"
        );
      }
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
      await fs.writeFile(
        path.join(extractDir, "pipelines", "fastqc", "manifest.json"),
        JSON.stringify({ id: "fastqc", source: "public-release" }, null, 2),
        "utf8"
      );
      await fs.writeFile(
        path.join(extractDir, "scripts", "apply-install-profile.mjs"),
        "console.log('new profile applicator');\n",
        "utf8"
      );
      return { stdout: "" };
    }

    const copyMatch = command.match(/^cp -R "(.+)" "(.+)"$/);
    if (copyMatch) {
      const sourceDir = copyMatch[1].replace(/[\\/]\.$/, "");
      await copyDirectoryContents(sourceDir, copyMatch[2]);
      return { stdout: "" };
    }

    if (command === "node scripts/run-prisma.mjs migrate deploy") {
      expectUpdateExecOptions(execOptions);
      return { stdout: "" };
    }

    if (
      command === "npm ci --omit=dev --no-audit --no-fund" ||
      command === "npm install --omit=dev --no-audit --no-fund"
    ) {
      const commandCwd = expectUpdateExecOptions(execOptions);
      await fs.mkdir(path.join(commandCwd, "node_modules", ".bin"), { recursive: true });
      await fs.writeFile(path.join(commandCwd, "node_modules", ".bin", "next"), "#!/bin/sh\n", "utf8");
      await fs.writeFile(path.join(commandCwd, "node_modules", ".bin", "prisma"), "#!/bin/sh\n", "utf8");
      return { stdout: "" };
    }

    if (command === "node scripts/run-prisma.mjs generate") {
      expectUpdateExecOptions(execOptions);
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
  readUpdateStateMock.mockResolvedValue(null);
  writeUpdateStateMock.mockImplementation(async (state) => ({
    ...state,
    updatedAt: new Date().toISOString(),
  }));
  patchUpdateStateMock.mockImplementation(async (state) => ({
    phase: state.phase || "preparing",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...state,
  }));
  requirePostgresDatabaseUrlMock.mockImplementation((value: string) => value);
  loadInstalledDatabaseConfigMock.mockResolvedValue({
    databaseUrl: "postgresql://installed.example/seqdesk",
    directUrl: null,
    provider: "postgresql",
  });
  getDatabaseCompatibilityErrorMock.mockReturnValue(undefined);
  mocks.dbMock.order.count.mockResolvedValue(4);
  mocks.dbMock.sample.count.mockResolvedValue(8);
  mocks.dbMock.study.count.mockResolvedValue(2);
  mocks.dbMock.user.count.mockResolvedValue(3);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
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

    const releaseDir = path.join(tempDir, "releases", "1.2.0");
    await expect(fs.readFile(path.join(releaseDir, "package.json"), "utf8")).resolves.toContain(
      '"version": "1.2.0"'
    );
    await expect(fs.readFile(path.join(tempDir, "package.json"), "utf8")).resolves.toContain(
      '"version": "1.1.80"'
    );
    await expect(
      fs.readFile(path.join(tempDir, "seqdesk.config.json"), "utf8")
    ).resolves.toContain("preserved.example");
    await expect(fs.readFile(path.join(releaseDir, "seqdesk.config.json"), "utf8")).resolves.toContain(
      "preserved.example"
    );
    await expect(fs.readFile(path.join(releaseDir, "public", "new.txt"), "utf8")).resolves.toBe(
      "new\n"
    );
    await expect(
      fs.readFile(path.join(tempDir, "pipelines", "metaxpath", "manifest.json"), "utf8")
    ).resolves.toContain("private-installed");
    await expect(
      fs.readFile(path.join(tempDir, "pipelines", "fastqc", "manifest.json"), "utf8")
    ).resolves.toContain("public-release");
    await expect(
      fs.readFile(path.join(releaseDir, "scripts", "apply-install-profile.mjs"), "utf8")
    ).resolves.toContain("new profile applicator");
    await expect(fs.readFile(path.join(tempDir, "current", "package.json"), "utf8")).resolves.toContain(
      '"version": "1.2.0"'
    );
    await expect(fs.readlink(path.join(tempDir, "current"))).resolves.toBe("releases/1.2.0");
    expect((await fs.lstat(path.join(releaseDir, "seqdesk.config.json"))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(releaseDir, "data"))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(releaseDir, "pipelines"))).isSymbolicLink()).toBe(true);
    await expect(fs.readFile(path.join(tempDir, "start.sh"), "utf8")).resolves.toContain(
      'cd "$ROOT_DIR/current"'
    );
    await expect(fs.access(path.join(tempDir, ".update-temp"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    expect(progress).toEqual([
      "downloading:5",
      "downloading:10",
      "downloading:30",
      "extracting:40",
      "extracting:55",
      "extracting:70",
      "extracting:82",
      "extracting:88",
      "extracting:93",
      "complete:100",
      "restarting:100",
    ]);
    expect(requirePostgresDatabaseUrlMock).toHaveBeenCalledWith(
      "postgresql://installed.example/seqdesk"
    );
    const commands = execMock.mock.calls.map((call) => call[0]);
    expect(commands).toEqual(
      expect.arrayContaining([
        "npm ci --omit=dev --no-audit --no-fund",
        "node scripts/run-prisma.mjs generate",
        "node scripts/run-prisma.mjs migrate deploy",
      ])
    );
    const npmCall = execMock.mock.calls.find((call) => call[0] === "npm ci --omit=dev --no-audit --no-fund");
    const npmOptions = npmCall?.[1] as { cwd?: string };
    expect(npmOptions.cwd).toContain(path.join(".update-temp", "staged-1.2.0"));
    expect(writeUpdateStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "preparing",
        targetVersion: "1.2.0",
        targetRelease: path.join(tempDir, "releases", "1.2.0"),
      })
    );
    expect(patchUpdateStateMock).toHaveBeenCalledWith(expect.objectContaining({ phase: "staged" }));
    expect(patchUpdateStateMock).toHaveBeenCalledWith(expect.objectContaining({ phase: "activating" }));
    expect(patchUpdateStateMock).toHaveBeenCalledWith(expect.objectContaining({ phase: "migrating" }));
    expect(patchUpdateStateMock).toHaveBeenCalledWith(expect.objectContaining({ phase: "complete" }));
    expect(releaseUpdateLockMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to npm install only when the staged package-lock.json is missing", async () => {
    configureInstallerShell({ includeExtractedLockfile: false });
    const mod = await loadInstallerModule();

    await mod.installUpdate(createRelease());

    const commands = execMock.mock.calls.map((call) => call[0]);
    expect(commands).toContain("npm install --omit=dev --no-audit --no-fund");
    expect(commands).not.toContain("npm ci --omit=dev --no-audit --no-fund");
  });

  it("falls back to npm install when npm ci hits an NFS-held Prisma client file", async () => {
    configureInstallerShell();
    const baseResponder = execResponder;
    execResponder = async (command: string, execOptions?: unknown) => {
      if (command === "npm ci --omit=dev --no-audit --no-fund") {
        const commandCwd = expectUpdateExecOptions(execOptions);
        expect(commandCwd).toContain(path.join(".update-temp", "staged-1.2.0"));
        return {
          error: createExecError("Command failed: npm ci --omit=dev --no-audit --no-fund"),
          stderr:
            "npm error EBUSY: resource busy or locked, unlink '/net/broker/devphil/seqdesk/node_modules/.prisma/client/.nfs00000000868fed8800000039'",
        };
      }
      return baseResponder(command, execOptions);
    };
    const mod = await loadInstallerModule();

    await mod.installUpdate(createRelease());

    const commands = execMock.mock.calls.map((call) => call[0]);
    expect(commands).toEqual(
      expect.arrayContaining([
        "npm ci --omit=dev --no-audit --no-fund",
        "npm install --omit=dev --no-audit --no-fund",
        "node scripts/run-prisma.mjs generate",
      ])
    );
    expect(console.warn).toHaveBeenCalledWith(
      "npm ci could not remove an NFS-held Prisma client artifact; retrying with npm install."
    );
  });

  it("does not activate a release when staged dependency installation fails", async () => {
    configureInstallerShell();
    const baseResponder = execResponder;
    execResponder = async (command: string, execOptions?: unknown) => {
      if (command === "npm ci --omit=dev --no-audit --no-fund") {
        expectUpdateExecOptions(execOptions);
        return { error: createExecError("npm failed") };
      }
      return baseResponder(command, execOptions);
    };
    const mod = await loadInstallerModule();

    await expect(mod.installUpdate(createRelease())).rejects.toThrow("npm failed");

    await expect(fs.access(path.join(tempDir, "current"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.access(path.join(tempDir, "releases", "1.2.0"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.readFile(path.join(tempDir, "package.json"), "utf8")).resolves.toContain(
      '"version": "1.1.80"'
    );
  });

  it("rolls current back to the previous release when migrations fail after activation", async () => {
    await seedReleaseLayout("1.1.80");
    process.chdir(path.join(tempDir, "current"));
    configureInstallerShell();
    const baseResponder = execResponder;
    execResponder = async (command: string, execOptions?: unknown) => {
      if (command === "node scripts/run-prisma.mjs migrate deploy") {
        expectUpdateExecOptions(execOptions);
        return { error: createExecError("migration failed") };
      }
      return baseResponder(command, execOptions);
    };
    const mod = await loadInstallerModule();

    await expect(mod.installUpdate(createRelease())).rejects.toThrow("migration failed");

    await expect(fs.readlink(path.join(tempDir, "current"))).resolves.toBe("releases/1.1.80");
    await expect(fs.access(path.join(tempDir, "releases", "1.2.0"))).resolves.toBeUndefined();
    expect(patchUpdateStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "error",
        activeRelease: path.join(tempDir, "releases", "1.1.80"),
      })
    );
  });

  it("rolls back to the previous release recorded in update state", async () => {
    await seedReleaseLayout("1.1.80");
    const newReleaseDir = path.join(tempDir, "releases", "1.2.0");
    await fs.mkdir(newReleaseDir, { recursive: true });
    await fs.writeFile(
      path.join(newReleaseDir, "package.json"),
      JSON.stringify({ version: "1.2.0" }, null, 2),
      "utf8"
    );
    await fs.writeFile(path.join(newReleaseDir, "start.sh"), "#!/usr/bin/env bash\nnode server.js\n", "utf8");
    await fs.rm(path.join(tempDir, "current"));
    await fs.symlink(path.join("releases", "1.2.0"), path.join(tempDir, "current"), "dir");
    process.chdir(path.join(tempDir, "current"));
    readUpdateStateMock.mockResolvedValue({
      phase: "complete",
      startedAt: "2026-05-20T10:00:00.000Z",
      updatedAt: "2026-05-20T10:01:00.000Z",
      previousRelease: path.join(tempDir, "releases", "1.1.80"),
      targetRelease: path.join(tempDir, "releases", "1.2.0"),
      activeRelease: path.join(tempDir, "releases", "1.2.0"),
      targetVersion: "1.2.0",
    });
    configureInstallerShell();
    const progress: string[] = [];
    const mod = await loadInstallerModule();

    await mod.rollbackInstalledUpdate((entry) => {
      progress.push(`${entry.status}:${entry.progress}`);
    });

    await expect(fs.readlink(path.join(tempDir, "current"))).resolves.toBe("releases/1.1.80");
    expect(progress).toEqual(["checking:5", "extracting:60", "complete:100", "restarting:100"]);
    expect(patchUpdateStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "rollback_started",
        previousRelease: path.join(tempDir, "releases", "1.2.0"),
        targetRelease: path.join(tempDir, "releases", "1.1.80"),
      })
    );
    expect(patchUpdateStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "rolled_back",
        activeRelease: path.join(tempDir, "releases", "1.1.80"),
      })
    );
    expect(releaseUpdateLockMock).toHaveBeenCalledTimes(1);
  });

  it("repairs an already applied update without downloading a release", async () => {
    configureInstallerShell();
    const progress: string[] = [];
    const mod = await loadInstallerModule();

    await mod.repairInstalledUpdate("1.2.0", (entry) => {
      progress.push(`${entry.status}:${entry.progress}`);
    });

    const commands = execMock.mock.calls.map((call) => call[0]);
    expect(commands).toEqual(
      expect.arrayContaining([
        "npm install --omit=dev --no-audit --no-fund",
        "node scripts/run-prisma.mjs generate",
        "node scripts/run-prisma.mjs migrate deploy",
      ])
    );
    expect(commands).not.toContain("npm ci --omit=dev --no-audit --no-fund");
    expect(commands.some((command) => String(command).startsWith("curl -fsSL"))).toBe(false);
    expect(progress).toEqual([
      "extracting:20",
      "extracting:45",
      "extracting:70",
      "complete:100",
      "restarting:100",
    ]);
    expect(releaseUpdateLockMock).toHaveBeenCalledTimes(1);
  });

  it("repairs the active current release when the release layout is installed", async () => {
    await seedReleaseLayout("1.1.80");
    process.chdir(path.join(tempDir, "releases", "1.1.80"));
    configureInstallerShell();
    const mod = await loadInstallerModule();

    await mod.repairInstalledUpdate("1.1.80");

    const npmCall = execMock.mock.calls.find(
      (call) => call[0] === "npm install --omit=dev --no-audit --no-fund"
    );
    const generateCall = execMock.mock.calls.find(
      (call) => call[0] === "node scripts/run-prisma.mjs generate"
    );
    expect((npmCall?.[1] as { cwd?: string }).cwd).toBe(path.join(tempDir, "current"));
    expect((generateCall?.[1] as { cwd?: string }).cwd).toBe(path.join(tempDir, "current"));
  });

  it("fails when runtime dependency install does not create a local Prisma CLI", async () => {
    configureInstallerShell();
    const baseResponder = execResponder;
    execResponder = async (command: string, execOptions?: unknown) => {
      if (command === "npm ci --omit=dev --no-audit --no-fund") {
        const commandCwd = expectUpdateExecOptions(execOptions);
        await fs.mkdir(path.join(commandCwd, "node_modules", ".bin"), { recursive: true });
        await fs.writeFile(path.join(commandCwd, "node_modules", ".bin", "next"), "#!/bin/sh\n", "utf8");
        return { stdout: "" };
      }
      return baseResponder(command, execOptions);
    };
    const mod = await loadInstallerModule();

    await expect(mod.installUpdate(createRelease())).rejects.toThrow(
      "Runtime dependency install did not create node_modules/.bin/prisma"
    );
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

  it("rejects an unsupported checksum algorithm", async () => {
    configureInstallerShell();
    const mod = await loadInstallerModule();

    await expect(
      mod.installUpdate(
        createRelease({
          checksum: "md5:abcdef1234567890",
        })
      )
    ).rejects.toThrow("Unsupported checksum algorithm: md5");
  });

  it("rejects unsafe release metadata before shell-backed install steps", async () => {
    const mod = await loadInstallerModule();

    await expect(
      mod.installUpdate(createRelease({ version: "../1.2.0" }))
    ).rejects.toThrow("Invalid release version");

    await expect(
      mod.installUpdate(createRelease({ downloadUrl: "file:///tmp/update.tar.gz" }))
    ).rejects.toThrow("Unsupported download URL protocol: file:");

    await expect(
      mod.installUpdate(createRelease({ checksum: "sha256:not-a-real-sha" }))
    ).rejects.toThrow("Invalid sha256 checksum");

    expect(execMock).not.toHaveBeenCalled();
  });

  it("skips disk space check on non-unix platforms", async () => {
    platformMock.mockReturnValue("win32");
    configureInstallerShell();
    const progress: string[] = [];
    const mod = await loadInstallerModule();

    await mod.installUpdate(createRelease(), (entry) => {
      progress.push(`${entry.status}:${entry.progress}`);
    });

    expect(progress[0]).toBe("downloading:5");
    expect(progress).toContain("complete:100");
  });

  it("rejects when database compatibility check fails", async () => {
    getDatabaseCompatibilityErrorMock.mockReturnValue(
      "This release requires PostgreSQL but SQLite is installed."
    );
    const mod = await loadInstallerModule();

    await expect(mod.installUpdate(createRelease())).rejects.toThrow(
      "This release requires PostgreSQL but SQLite is installed."
    );

    expect(releaseUpdateLockMock).toHaveBeenCalledTimes(1);
  });

  it("uses an expanded command output buffer for updater shell steps", async () => {
    configureInstallerShell();
    const mod = await loadInstallerModule();

    await mod.installUpdate(createRelease());

    expect(execMock).toHaveBeenCalled();
    for (const call of execMock.mock.calls) {
      const options = typeof call[1] === "function" ? undefined : call[1];
      expect(options).toEqual(
        expect.objectContaining({ maxBuffer: UPDATE_COMMAND_MAX_BUFFER })
      );
    }
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
