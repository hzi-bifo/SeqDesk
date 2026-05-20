import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

let cwd = "";
let tempDir = "";

async function loadStatusModule() {
  vi.resetModules();
  return import("./status");
}

beforeEach(async () => {
  vi.clearAllMocks();
  cwd = process.cwd();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-update-status-"));
  process.chdir(tempDir);
});

afterEach(async () => {
  process.chdir(cwd);
  await fs.rm(tempDir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("updater status helpers", () => {
  it("writes, reads, and clears the update status file", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-18T12:00:00.000Z"));

    const mod = await loadStatusModule();

    await mod.writeUpdateStatus(
      {
        status: "downloading",
        progress: 42,
        message: "Downloading",
      },
      { targetVersion: "1.2.0" }
    );

    await expect(mod.readUpdateStatus()).resolves.toEqual({
      status: "downloading",
      progress: 42,
      message: "Downloading",
      targetVersion: "1.2.0",
      updatedAt: "2026-03-18T12:00:00.000Z",
    });
    await expect(mod.isUpdateInProgress()).resolves.toBe(true);

    await mod.clearUpdateStatus();
    await expect(mod.readUpdateStatus()).resolves.toBeNull();
    await expect(mod.isUpdateInProgress()).resolves.toBe(false);
  });

  it("acquires and releases the update lock", async () => {
    const mod = await loadStatusModule();

    await expect(mod.acquireUpdateLock()).resolves.toBe(true);
    await expect(mod.acquireUpdateLock()).resolves.toBe(false);

    await mod.releaseUpdateLock();
    await expect(mod.acquireUpdateLock()).resolves.toBe(true);
  });

  it("replaces stale locks after the ttl expires", async () => {
    const mod = await loadStatusModule();
    const lockPath = path.join(tempDir, ".update-lock");

    await fs.writeFile(lockPath, "{}", "utf8");
    const staleTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(lockPath, staleTime, staleTime);

    await expect(mod.acquireUpdateLock()).resolves.toBe(true);
    await expect(fs.readFile(lockPath, "utf8")).resolves.toContain(`"pid": ${process.pid}`);
  });

  it("writes and patches update state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:00:00.000Z"));
    const mod = await loadStatusModule();

    await mod.writeUpdateState({
      phase: "preparing",
      startedAt: "2026-05-20T11:59:00.000Z",
      previousRelease: "/srv/seqdesk/releases/1.1.80",
      targetRelease: "/srv/seqdesk/releases/1.2.0",
      targetVersion: "1.2.0",
    });

    vi.setSystemTime(new Date("2026-05-20T12:01:00.000Z"));
    await mod.patchUpdateState({
      phase: "activating",
      activeRelease: "/srv/seqdesk/releases/1.2.0",
    });

    await expect(mod.readUpdateState()).resolves.toEqual({
      phase: "activating",
      startedAt: "2026-05-20T11:59:00.000Z",
      updatedAt: "2026-05-20T12:01:00.000Z",
      previousRelease: "/srv/seqdesk/releases/1.1.80",
      targetRelease: "/srv/seqdesk/releases/1.2.0",
      activeRelease: "/srv/seqdesk/releases/1.2.0",
      targetVersion: "1.2.0",
    });
  });

  it("stores status at install root when running from current release", async () => {
    const releaseDir = path.join(tempDir, "releases", "1.2.0");
    await fs.mkdir(releaseDir, { recursive: true });
    await fs.symlink(path.join("releases", "1.2.0"), path.join(tempDir, "current"), "dir");
    process.chdir(path.join(tempDir, "current"));
    const mod = await loadStatusModule();

    await mod.writeUpdateStatus({
      status: "checking",
      progress: 0,
      message: "Preparing",
    });

    await expect(fs.access(path.join(tempDir, ".update-status.json"))).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(tempDir, "current", ".update-status.json"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
