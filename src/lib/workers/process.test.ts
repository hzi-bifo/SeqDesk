import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  db: {
    backgroundWorkerProcess: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { isProcessAlive, reconcileWorker, stopWorker, tailLog } from "./process";

describe("isProcessAlive", () => {
  it("returns true for the current process pid", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("returns false for an obviously invalid pid", () => {
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(Number.NaN)).toBe(false);
  });

  it("returns false for a pid that does not exist", () => {
    // 99999999 is virtually guaranteed not to be a real PID on a fresh system,
    // and process.kill returns ESRCH for it.
    expect(isProcessAlive(99_999_999)).toBe(false);
  });

  it("treats EPERM (permission denied to signal) as alive", () => {
    const spy = vi.spyOn(process, "kill").mockImplementation(() => {
      const err = new Error("permission denied") as NodeJS.ErrnoException;
      err.code = "EPERM";
      throw err;
    });
    try {
      expect(isProcessAlive(1)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("tailLog", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tail-log-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty array when the file does not exist", async () => {
    const result = await tailLog(path.join(tmpDir, "missing.log"));
    expect(result).toEqual([]);
  });

  it("returns the last N lines of a log file (default 200)", async () => {
    const file = path.join(tmpDir, "many.log");
    const lines = Array.from({ length: 250 }, (_, i) => `line-${i + 1}`);
    await fs.writeFile(file, lines.join("\n") + "\n", "utf8");

    const result = await tailLog(file);
    expect(result.length).toBe(200);
    expect(result[0]).toBe("line-51");
    expect(result[result.length - 1]).toBe("line-250");
  });

  it("respects a custom number of lines", async () => {
    const file = path.join(tmpDir, "small.log");
    await fs.writeFile(file, ["a", "b", "c", "d", "e"].join("\n") + "\n", "utf8");

    const result = await tailLog(file, 3);
    expect(result).toEqual(["c", "d", "e"]);
  });

  it("handles a file with fewer lines than requested", async () => {
    const file = path.join(tmpDir, "short.log");
    await fs.writeFile(file, "only-line\n", "utf8");

    expect(await tailLog(file, 100)).toEqual(["only-line"]);
  });

  it("returns empty array for an empty file", async () => {
    const file = path.join(tmpDir, "empty.log");
    await fs.writeFile(file, "", "utf8");

    expect(await tailLog(file)).toEqual([]);
  });
});

describe("reconcileWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws for an unknown worker name", async () => {
    await expect(reconcileWorker("not-a-real-worker")).rejects.toThrow(/unknown worker/);
  });

  it("returns the spec with row=null when no DB row exists", async () => {
    mocks.db.backgroundWorkerProcess.findFirst.mockResolvedValue(null);

    const result = await reconcileWorker("stream-monitor");

    expect(result.spec.name).toBe("stream-monitor");
    expect(result.row).toBeNull();
    expect(mocks.db.backgroundWorkerProcess.findFirst).toHaveBeenCalledWith({
      where: { name: "stream-monitor" },
      orderBy: { startedAt: "desc" },
      include: { startedBy: { select: { email: true } } },
    });
  });

  it("returns RUNNING status for a row whose pid is alive", async () => {
    const startedAt = new Date("2026-05-07T12:00:00Z");
    mocks.db.backgroundWorkerProcess.findFirst.mockResolvedValue({
      id: "row-1",
      name: "stream-monitor",
      pid: process.pid,
      status: "RUNNING",
      startedAt,
      stoppedAt: null,
      exitCode: null,
      logPath: "/tmp/seqdesk/stream-monitor.log",
      lastErrorMsg: null,
      startedBy: { email: "admin@example.com" },
    });

    const result = await reconcileWorker("stream-monitor");

    expect(result.row).toMatchObject({
      id: "row-1",
      pid: process.pid,
      status: "RUNNING",
      startedByEmail: "admin@example.com",
    });
    expect(result.row?.startedAt).toBe(startedAt.toISOString());
    expect(mocks.db.backgroundWorkerProcess.update).not.toHaveBeenCalled();
  });

  it("flips RUNNING to STOPPED when the pid is no longer alive", async () => {
    const startedAt = new Date("2026-05-07T12:00:00Z");
    mocks.db.backgroundWorkerProcess.findFirst.mockResolvedValue({
      id: "row-zombie",
      name: "stream-monitor",
      pid: 99_999_999, // virtually guaranteed dead
      status: "RUNNING",
      startedAt,
      stoppedAt: null,
      exitCode: null,
      logPath: "/tmp/x.log",
      lastErrorMsg: null,
      startedBy: null,
    });
    mocks.db.backgroundWorkerProcess.update.mockResolvedValue({});

    const result = await reconcileWorker("stream-monitor");

    expect(result.row?.status).toBe("STOPPED");
    expect(mocks.db.backgroundWorkerProcess.update).toHaveBeenCalledTimes(1);
    const update = mocks.db.backgroundWorkerProcess.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: "row-zombie" });
    expect(update.data.status).toBe("STOPPED");
    expect(update.data.stoppedAt).toBeInstanceOf(Date);
  });

  it("flips STOPPING to STOPPED when the pid is no longer alive", async () => {
    mocks.db.backgroundWorkerProcess.findFirst.mockResolvedValue({
      id: "row-stop",
      name: "stream-monitor",
      pid: 99_999_998,
      status: "STOPPING",
      startedAt: new Date(),
      stoppedAt: null,
      exitCode: null,
      logPath: "/tmp/x.log",
      lastErrorMsg: null,
      startedBy: null,
    });
    mocks.db.backgroundWorkerProcess.update.mockResolvedValue({});

    const result = await reconcileWorker("stream-monitor");

    expect(result.row?.status).toBe("STOPPED");
  });

  it("clears a persisted ZOMBIE row to STOPPED", async () => {
    const stoppedAt = new Date("2026-05-07T14:00:00Z");
    mocks.db.backgroundWorkerProcess.findFirst.mockResolvedValue({
      id: "row-legacy-zombie",
      name: "stream-monitor",
      pid: 99_999_997,
      status: "ZOMBIE",
      startedAt: new Date("2026-05-07T12:00:00Z"),
      stoppedAt,
      exitCode: null,
      logPath: "/tmp/x.log",
      lastErrorMsg: null,
      startedBy: null,
    });
    mocks.db.backgroundWorkerProcess.update.mockResolvedValue({});

    const result = await reconcileWorker("stream-monitor");

    expect(result.row?.status).toBe("STOPPED");
    expect(result.row?.stoppedAt).toBe(stoppedAt.toISOString());
    expect(mocks.db.backgroundWorkerProcess.update).toHaveBeenCalledWith({
      where: { id: "row-legacy-zombie" },
      data: { status: "STOPPED", stoppedAt },
    });
  });

  it("does not change status when the row is already STOPPED", async () => {
    const stoppedAt = new Date("2026-05-07T13:00:00Z");
    mocks.db.backgroundWorkerProcess.findFirst.mockResolvedValue({
      id: "row-stopped",
      name: "stream-monitor",
      pid: 99_999_996, // dead, but doesn't matter
      status: "STOPPED",
      startedAt: new Date(),
      stoppedAt,
      exitCode: 0,
      logPath: "/tmp/x.log",
      lastErrorMsg: null,
      startedBy: null,
    });

    const result = await reconcileWorker("stream-monitor");

    expect(result.row?.status).toBe("STOPPED");
    expect(result.row?.stoppedAt).toBe(stoppedAt.toISOString());
    expect(mocks.db.backgroundWorkerProcess.update).not.toHaveBeenCalled();
  });

  it("survives a transient DB update failure when flipping to STOPPED", async () => {
    mocks.db.backgroundWorkerProcess.findFirst.mockResolvedValue({
      id: "row-flake",
      name: "stream-monitor",
      pid: 99_999_995,
      status: "RUNNING",
      startedAt: new Date(),
      stoppedAt: null,
      exitCode: null,
      logPath: "/tmp/x.log",
      lastErrorMsg: null,
      startedBy: null,
    });
    mocks.db.backgroundWorkerProcess.update.mockRejectedValue(new Error("transient"));

    const result = await reconcileWorker("stream-monitor");

    // Even if the persistence fails the in-memory result still reports STOPPED.
    expect(result.row?.status).toBe("STOPPED");
  });
});

describe("stopWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.backgroundWorkerProcess.update.mockResolvedValue({});
  });

  it("returns { stopped: false } when the row is missing", async () => {
    mocks.db.backgroundWorkerProcess.findUnique.mockResolvedValue(null);

    const result = await stopWorker("missing");

    expect(result).toEqual({ stopped: false });
    expect(mocks.db.backgroundWorkerProcess.update).not.toHaveBeenCalled();
  });

  it("returns { stopped: true } when the row is already STOPPED", async () => {
    mocks.db.backgroundWorkerProcess.findUnique.mockResolvedValue({
      id: "row-1",
      pid: 12345,
      status: "STOPPED",
    });

    const result = await stopWorker("row-1");

    expect(result).toEqual({ stopped: true });
    expect(mocks.db.backgroundWorkerProcess.update).not.toHaveBeenCalled();
  });

  it("returns { stopped: true } when the row is already ERROR", async () => {
    mocks.db.backgroundWorkerProcess.findUnique.mockResolvedValue({
      id: "row-2",
      pid: 12345,
      status: "ERROR",
    });

    expect(await stopWorker("row-2")).toEqual({ stopped: true });
    expect(mocks.db.backgroundWorkerProcess.update).not.toHaveBeenCalled();
  });

  it("flips status to STOPPING then STOPPED for an already-dead pid", async () => {
    // Use a pid that doesn't exist so the polling loop exits immediately
    // and we don't have to fake timers.
    mocks.db.backgroundWorkerProcess.findUnique.mockResolvedValue({
      id: "row-3",
      pid: 99_999_995,
      status: "RUNNING",
    });

    const result = await stopWorker("row-3", { graceMs: 50 });

    expect(result).toEqual({ stopped: true });
    expect(mocks.db.backgroundWorkerProcess.update).toHaveBeenCalledTimes(2);
    expect(mocks.db.backgroundWorkerProcess.update.mock.calls[0][0]).toEqual({
      where: { id: "row-3" },
      data: { status: "STOPPING" },
    });
    const finalUpdate = mocks.db.backgroundWorkerProcess.update.mock.calls[1][0];
    expect(finalUpdate.where).toEqual({ id: "row-3" });
    expect(finalUpdate.data.status).toBe("STOPPED");
    expect(finalUpdate.data.stoppedAt).toBeInstanceOf(Date);
  });

  it("issues SIGKILL when the process is still alive after the grace window", async () => {
    mocks.db.backgroundWorkerProcess.findUnique.mockResolvedValue({
      id: "row-4",
      pid: 12345,
      status: "RUNNING",
    });

    const calls: Array<{ pid: number; signal: number | string }> = [];
    let aliveAfterTerm = true;
    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      calls.push({ pid: pid as number, signal: signal as number | string });
      if (signal === "SIGKILL") {
        aliveAfterTerm = false;
        return true;
      }
      if (signal === 0 && !aliveAfterTerm) {
        const err = new Error("no such process") as NodeJS.ErrnoException;
        err.code = "ESRCH";
        throw err;
      }
      // SIGTERM: pretend the process is stubborn (doesn't die).
      return true;
    });

    try {
      const result = await stopWorker("row-4", { graceMs: 5 });
      expect(result).toEqual({ stopped: true });
      expect(calls.some((c) => c.signal === "SIGTERM")).toBe(true);
      expect(calls.some((c) => c.signal === "SIGKILL")).toBe(true);
    } finally {
      killSpy.mockRestore();
    }
  });

  it("treats a SIGTERM kill failure as an already-dead process", async () => {
    mocks.db.backgroundWorkerProcess.findUnique.mockResolvedValue({
      id: "row-5",
      pid: 12345,
      status: "RUNNING",
    });

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      const err = new Error("no such process") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });

    try {
      const result = await stopWorker("row-5", { graceMs: 5 });
      expect(result).toEqual({ stopped: true });
    } finally {
      killSpy.mockRestore();
    }
  });

  it("ignores a SIGKILL failure (best-effort)", async () => {
    mocks.db.backgroundWorkerProcess.findUnique.mockResolvedValue({
      id: "row-6",
      pid: 12345,
      status: "RUNNING",
    });

    let signalsSent = 0;
    const killSpy = vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
      if (signal === 0) {
        // Liveness check — say alive every time so SIGKILL is attempted.
        return true;
      }
      signalsSent += 1;
      if (signal === "SIGKILL") {
        const err = new Error("perm") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }
      return true;
    });

    try {
      const result = await stopWorker("row-6", { graceMs: 5 });
      expect(result).toEqual({ stopped: true });
      expect(signalsSent).toBeGreaterThanOrEqual(2); // SIGTERM + SIGKILL
    } finally {
      killSpy.mockRestore();
    }
  });
});
