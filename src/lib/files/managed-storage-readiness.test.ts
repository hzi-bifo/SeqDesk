import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getResolvedDataBasePath: vi.fn(),
  accessFailure: null as null | ((target: string) => boolean),
  realpathOverride: null as null | ((target: string, resolved: string) => string),
  statfsValue: null as null | { bsize: bigint; bavail: bigint },
  renameFailure: false,
  beforeProbeRename: null as null | ((oldPath: string) => void),
  observedProbeMode: null as number | null,
}));

vi.mock("@/lib/files/data-base-path", () => ({
  getResolvedDataBasePath: mocks.getResolvedDataBasePath,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    access: async (target: fs.PathLike, mode?: number) => {
      if (mocks.accessFailure?.(String(target))) {
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      }
      return actual.access(target, mode);
    },
    realpath: async (target: fs.PathLike) => {
      const resolved = await actual.realpath(target);
      return mocks.realpathOverride?.(String(target), resolved) ?? resolved;
    },
    statfs: async (
      target: fs.PathLike,
      options?: { bigint?: boolean }
    ) => {
      if (mocks.statfsValue) return mocks.statfsValue;
      return actual.statfs(target, options as { bigint: true });
    },
    rename: async (oldPath: fs.PathLike, newPath: fs.PathLike) => {
      if (String(oldPath).endsWith("write-probe.tmp")) {
        mocks.observedProbeMode = fs.statSync(oldPath).mode & 0o777;
        mocks.beforeProbeRename?.(String(oldPath));
        if (mocks.renameFailure) {
          throw Object.assign(new Error("rename failed"), { code: "EIO" });
        }
      }
      return actual.rename(oldPath, newPath);
    },
  };
});

import {
  checkManagedStorageReadiness,
  resolveManagedStorageFingerprint,
} from "./managed-storage-readiness";

const tempDirectories: string[] = [];

function makeTempDirectory(prefix = "seqdesk-managed-storage-"): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
}

function configurePath(
  dataBasePath: string | null,
  options: { source?: "file" | "database" | "local-dev" | "none"; implicit?: boolean } = {}
) {
  mocks.getResolvedDataBasePath.mockResolvedValue({
    dataBasePath,
    source: options.source ?? (dataBasePath ? "file" : "none"),
    isImplicit: options.implicit ?? false,
  });
}

describe("managed storage readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accessFailure = null;
    mocks.realpathOverride = null;
    mocks.statfsValue = null;
    mocks.renameFailure = false;
    mocks.beforeProbeRename = null;
    mocks.observedProbeMode = null;
  });

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("verifies the effective directory with a private 0600 write probe", async () => {
    const directory = makeTempDirectory();
    configurePath(directory);

    const readiness = await checkManagedStorageReadiness();

    expect(readiness).toMatchObject({
      ready: true,
      status: "ready",
      summary: "Managed storage is ready for SeqDesk writes.",
      metrics: {
        configured: true,
        source: "file",
        implicit: false,
        readable: true,
        writable: true,
      },
    });
    expect(readiness.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(readiness.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(readiness.metrics.availableBytes).toMatch(/^\d+$/);
    expect(readiness.checks.map((check) => check.id)).toEqual([
      "configuration",
      "path",
      "capacity",
      "read-access",
      "write-probe",
    ]);
    expect(mocks.observedProbeMode).toBe(0o600);
    expect(
      fs.readdirSync(directory).filter((entry) =>
        entry.startsWith(".seqdesk-storage-readiness-")
      )
    ).toEqual([]);
  });

  it("reports statfs capacity without losing bigint precision", async () => {
    const directory = makeTempDirectory();
    configurePath(directory);
    mocks.statfsValue = {
      bsize: BigInt(4096),
      bavail: BigInt("9007199254740993"),
    };

    const readiness = await checkManagedStorageReadiness();

    expect(readiness.ready).toBe(true);
    expect(readiness.metrics.availableBytes).toBe(
      (BigInt(4096) * BigInt("9007199254740993")).toString()
    );
  });

  it("does not create a missing configured root", async () => {
    const parent = makeTempDirectory();
    const missing = path.join(parent, "missing-storage");
    configurePath(missing);

    const readiness = await checkManagedStorageReadiness();

    expect(readiness.ready).toBe(false);
    expect(readiness.status).toBe("not-ready");
    expect(readiness.checks.at(-1)).toMatchObject({ id: "path", status: "fail" });
    expect(fs.existsSync(missing)).toBe(false);
  });

  it.each([
    [null, "none", false, /not configured/i],
    ["relative/storage", "file", false, /invalid/i],
    [path.parse(process.cwd()).root, "file", false, /unsafe/i],
  ] as const)(
    "rejects absent, relative, and root paths: %s",
    async (configuredPath, source, implicit, summary) => {
      configurePath(configuredPath, { source, implicit });

      const readiness = await checkManagedStorageReadiness();

      expect(readiness.ready).toBe(false);
      expect(readiness.summary).toMatch(summary);
    }
  );

  it("rejects an implicit local development fallback", async () => {
    const directory = makeTempDirectory();
    configurePath(directory, { source: "local-dev", implicit: true });

    const readiness = await checkManagedStorageReadiness();

    expect(readiness.ready).toBe(false);
    expect(readiness.metrics.implicit).toBe(true);
    expect(readiness.summary).toMatch(/explicitly/i);
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it("rejects a regular file and a directory unreadable by the service", async () => {
    const directory = makeTempDirectory();
    const regularFile = path.join(directory, "storage.txt");
    fs.writeFileSync(regularFile, "not a directory");
    configurePath(regularFile);

    const fileReadiness = await checkManagedStorageReadiness();
    expect(fileReadiness.ready).toBe(false);
    expect(fileReadiness.summary).toMatch(/not a directory/i);

    configurePath(directory);
    mocks.accessFailure = (target) => path.resolve(target) === path.resolve(directory);
    const unreadable = await checkManagedStorageReadiness();
    expect(unreadable.ready).toBe(false);
    expect(unreadable.checks.at(-1)).toMatchObject({
      id: "read-access",
      status: "fail",
    });
  });

  it("cleans its private directory when the write workflow fails", async () => {
    const directory = makeTempDirectory();
    configurePath(directory);
    mocks.renameFailure = true;

    const readiness = await checkManagedStorageReadiness();

    expect(readiness.ready).toBe(false);
    expect(readiness.checks.at(-1)).toMatchObject({
      id: "write-probe",
      status: "fail",
    });
    expect(
      fs.readdirSync(directory).filter((entry) =>
        entry.startsWith(".seqdesk-storage-readiness-")
      )
    ).toEqual([]);
  });

  it("does not suppress a probe error when its directory becomes a symlink", async () => {
    const directory = makeTempDirectory();
    const replacementTarget = makeTempDirectory();
    configurePath(directory);
    mocks.renameFailure = true;
    mocks.beforeProbeRename = (oldPath) => {
      const probeDirectory = path.dirname(oldPath);
      fs.rmSync(probeDirectory, { recursive: true });
      fs.symlinkSync(replacementTarget, probeDirectory, "dir");
    };

    const readiness = await checkManagedStorageReadiness();

    expect(readiness.ready).toBe(false);
    expect(readiness.checks.at(-1)).toMatchObject({
      id: "write-probe",
      status: "fail",
    });
    expect(fs.readdirSync(replacementTarget)).toEqual([]);
    expect(
      fs.readdirSync(directory).filter((entry) =>
        entry.startsWith(".seqdesk-storage-readiness-")
      )
    ).toEqual([]);
  });

  it("fails if a configured storage symlink retargets during the probe", async () => {
    const root = makeTempDirectory();
    const firstTarget = path.join(root, "first");
    const secondTarget = path.join(root, "second");
    const link = path.join(root, "storage");
    fs.mkdirSync(firstTarget);
    fs.mkdirSync(secondTarget);
    fs.symlinkSync(firstTarget, link, "dir");
    configurePath(link);

    let configuredRootResolutions = 0;
    mocks.realpathOverride = (target, resolved) => {
      if (path.resolve(target) !== path.resolve(link)) return resolved;
      configuredRootResolutions += 1;
      return configuredRootResolutions >= 2 ? secondTarget : resolved;
    };

    const readiness = await checkManagedStorageReadiness();

    expect(readiness.ready).toBe(false);
    expect(readiness.checks.at(-1)).toMatchObject({
      id: "write-probe",
      status: "fail",
    });
    expect(fs.readdirSync(firstTarget)).toEqual([]);
  });

  it("provides a cheap configuration fingerprint without following the storage path", async () => {
    const root = makeTempDirectory();
    const firstTarget = path.join(root, "first");
    const secondTarget = path.join(root, "second");
    const link = path.join(root, "storage");
    fs.mkdirSync(firstTarget);
    fs.mkdirSync(secondTarget);
    fs.symlinkSync(firstTarget, link, "dir");
    configurePath(link, { source: "database" });

    const first = await resolveManagedStorageFingerprint();
    fs.unlinkSync(link);
    fs.symlinkSync(secondTarget, link, "dir");
    const second = await resolveManagedStorageFingerprint();

    expect(first).toMatchObject({
      configurationState: "resolved",
      configured: true,
      source: "database",
      implicit: false,
    });
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(JSON.stringify(first)).not.toContain(link);
    expect(JSON.stringify(first)).not.toContain(firstTarget);

    configurePath(secondTarget, { source: "database" });
    const changedConfiguration = await resolveManagedStorageFingerprint();
    expect(changedConfiguration.fingerprint).not.toBe(first.fingerprint);
  });

  it("fails closed with a non-secret fingerprint when configuration resolution fails", async () => {
    mocks.getResolvedDataBasePath.mockRejectedValue(
      new Error("database failed with postgresql://user:secret@example/seqdesk")
    );

    const [fingerprint, readiness] = await Promise.all([
      resolveManagedStorageFingerprint(),
      checkManagedStorageReadiness(),
    ]);

    expect(fingerprint).toMatchObject({
      configurationState: "unavailable",
      configured: false,
      source: "none",
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.fingerprint).toBe(fingerprint.fingerprint);
    expect(JSON.stringify({ fingerprint, readiness })).not.toContain("postgresql://");
  });
});
