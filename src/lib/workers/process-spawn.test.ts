import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    backgroundWorkerProcess: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  spawn: vi.fn(),
  createWriteStream: vi.fn(),
  existsSync: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));

vi.mock("child_process", () => ({
  spawn: mocks.spawn,
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    default: actual,
    createWriteStream: mocks.createWriteStream,
    existsSync: mocks.existsSync,
    promises: {
      ...actual.promises,
      mkdir: mocks.mkdir,
    },
  };
});

import { startWorker } from "./process";
import { getWorkerSpec } from "./registry";

class FakeChildProcess extends EventEmitter {
  pid: number | undefined;
  stdout: { pipe: ReturnType<typeof vi.fn> };
  stderr: { pipe: ReturnType<typeof vi.fn> };
  unref = vi.fn();

  constructor(pid: number | undefined) {
    super();
    this.pid = pid;
    this.stdout = { pipe: vi.fn() };
    this.stderr = { pipe: vi.fn() };
  }
}

class FakeWriteStream {
  write = vi.fn();
  end = vi.fn();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mkdir.mockResolvedValue(undefined);
  // Pretend tsx is found at the first candidate dir.
  mocks.existsSync.mockReturnValue(true);
  mocks.createWriteStream.mockReturnValue(new FakeWriteStream());
  mocks.db.backgroundWorkerProcess.create.mockResolvedValue({
    id: "row-123",
    pid: 4242,
    logPath: "/tmp/seqdesk/logs/stream-monitor-4242.log",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startWorker", () => {
  it("spawns the worker, persists a row, and returns the PID", async () => {
    const child = new FakeChildProcess(4242);
    mocks.spawn.mockReturnValue(child);

    const spec = getWorkerSpec("stream-monitor")!;
    const result = await startWorker(spec, { startedById: "user-1" });

    expect(result).toEqual({
      id: "row-123",
      pid: 4242,
      logPath: "/tmp/seqdesk/logs/stream-monitor-4242.log",
    });

    // mkdir for the log directory was called.
    expect(mocks.mkdir).toHaveBeenCalledTimes(1);

    // spawn called with stream-monitor's script path and detached options.
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = mocks.spawn.mock.calls[0];
    expect(typeof cmd).toBe("string");
    expect(String(args[0]).replaceAll("\\", "/")).toMatch(
      /scripts\/stream-monitor\.(ts|js)$/
    );
    expect(opts).toMatchObject({
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // child stdout/stderr piped into the log stream and process detached.
    expect(child.stdout.pipe).toHaveBeenCalledTimes(1);
    expect(child.stderr.pipe).toHaveBeenCalledTimes(1);
    expect(child.unref).toHaveBeenCalledTimes(1);

    // DB row was persisted with RUNNING status and the actor id.
    expect(mocks.db.backgroundWorkerProcess.create).toHaveBeenCalledTimes(1);
    const { data } = mocks.db.backgroundWorkerProcess.create.mock.calls[0][0];
    expect(data).toMatchObject({
      name: "stream-monitor",
      pid: 4242,
      status: "RUNNING",
      startedById: "user-1",
    });
    expect(typeof data.logPath).toBe("string");
  });

  it("writes a startup banner into the log stream", async () => {
    const child = new FakeChildProcess(101);
    mocks.spawn.mockReturnValue(child);
    const writeStream = new FakeWriteStream();
    mocks.createWriteStream.mockReturnValue(writeStream);

    await startWorker(getWorkerSpec("pipeline-monitor")!);

    expect(writeStream.write).toHaveBeenCalledTimes(2);
    const [first, second] = writeStream.write.mock.calls.map((c) => c[0]);
    expect(first).toContain("starting pipeline-monitor");
    expect(first).toContain("pid=101");
    expect(second).toContain("cmd:");
  });

  it("falls back to bare `tsx` when no node_modules .bin/tsx is found", async () => {
    mocks.existsSync.mockReturnValue(false);
    const child = new FakeChildProcess(7);
    mocks.spawn.mockReturnValue(child);

    await startWorker(getWorkerSpec("stream-monitor")!);

    const [cmd] = mocks.spawn.mock.calls[0];
    expect(cmd).toBe("tsx");
  });

  it("propagates envOverrides into the child process env", async () => {
    const child = new FakeChildProcess(8);
    mocks.spawn.mockReturnValue(child);

    await startWorker(getWorkerSpec("stream-simulator")!);

    const opts = mocks.spawn.mock.calls[0][2];
    expect(opts.env.SIMULATE_INTERVAL_MS).toBe("15000");
    expect(opts.env.SIMULATE_BARCODES).toBe("barcode01,barcode02,barcode03");
  });

  it("includes static args from the registry", async () => {
    const child = new FakeChildProcess(9);
    mocks.spawn.mockReturnValue(child);

    await startWorker(getWorkerSpec("stream-simulator")!);

    const args = mocks.spawn.mock.calls[0][1];
    expect(args).toContain("--simulate");
    expect(args).toContain("--output-dir=/tmp/seqdesk-sim");
  });

  it("throws when spawn fails to assign a PID", async () => {
    const child = new FakeChildProcess(undefined);
    mocks.spawn.mockReturnValue(child);

    await expect(
      startWorker(getWorkerSpec("stream-monitor")!),
    ).rejects.toThrow(/no PID assigned/);
    expect(mocks.db.backgroundWorkerProcess.create).not.toHaveBeenCalled();
  });

  it("marks the row STOPPED when the child exits cleanly", async () => {
    const child = new FakeChildProcess(11);
    mocks.spawn.mockReturnValue(child);
    mocks.db.backgroundWorkerProcess.update.mockResolvedValue({});

    await startWorker(getWorkerSpec("stream-monitor")!);

    child.emit("exit", 0, null);
    await new Promise((r) => setImmediate(r));

    expect(mocks.db.backgroundWorkerProcess.update).toHaveBeenCalledTimes(1);
    const { data } = mocks.db.backgroundWorkerProcess.update.mock.calls[0][0];
    expect(data.status).toBe("STOPPED");
    expect(data.exitCode).toBe(0);
    expect(data.lastErrorMsg).toBeNull();
  });

  it("marks the row ERROR with the signal name when the child exits abnormally", async () => {
    const child = new FakeChildProcess(12);
    mocks.spawn.mockReturnValue(child);
    mocks.db.backgroundWorkerProcess.update.mockResolvedValue({});

    await startWorker(getWorkerSpec("stream-monitor")!);

    child.emit("exit", null, "SIGKILL");
    await new Promise((r) => setImmediate(r));

    const { data } = mocks.db.backgroundWorkerProcess.update.mock.calls[0][0];
    expect(data.status).toBe("ERROR");
    expect(data.exitCode).toBeNull();
    expect(data.lastErrorMsg).toBe("exited via signal SIGKILL");
  });

  it("ignores DB update failures from the exit listener", async () => {
    const child = new FakeChildProcess(13);
    mocks.spawn.mockReturnValue(child);
    mocks.db.backgroundWorkerProcess.update.mockRejectedValue(new Error("transient"));

    await startWorker(getWorkerSpec("stream-monitor")!);
    child.emit("exit", 1, null);

    // Should not throw, even with the rejected update.
    await new Promise((r) => setImmediate(r));
    expect(mocks.db.backgroundWorkerProcess.update).toHaveBeenCalled();
  });
});
