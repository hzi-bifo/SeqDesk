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
});
