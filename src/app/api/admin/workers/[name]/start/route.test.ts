import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getWorkerSpec: vi.fn(),
  isProcessAlive: vi.fn(),
  startWorker: vi.fn(),
  db: {
    backgroundWorkerProcess: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/workers/registry", () => ({
  getWorkerSpec: mocks.getWorkerSpec,
}));

vi.mock("@/lib/workers/process", () => ({
  isProcessAlive: mocks.isProcessAlive,
  startWorker: mocks.startWorker,
}));

import { POST } from "./route";

function context(name = "stream-monitor") {
  return { params: Promise.resolve({ name }) };
}

describe("POST /api/admin/workers/[name]/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.getWorkerSpec.mockReturnValue({
      name: "stream-monitor",
      label: "MinKNOW stream monitor",
      description: "Watches MinKNOW output",
      script: "scripts/stream-monitor.ts",
      supportsPause: true,
      devOnly: false,
    });
    mocks.db.backgroundWorkerProcess.findFirst.mockResolvedValue(null);
    mocks.db.backgroundWorkerProcess.update.mockResolvedValue({});
    mocks.isProcessAlive.mockReturnValue(false);
    mocks.startWorker.mockResolvedValue({
      id: "worker-new",
      pid: 4321,
      logPath: "/tmp/stream-monitor.log",
    });
  });

  it("marks a dead existing worker row STOPPED before spawning", async () => {
    const stoppedAt = new Date("2026-05-22T10:00:00.000Z");
    mocks.db.backgroundWorkerProcess.findFirst.mockResolvedValue({
      id: "worker-old",
      pid: 1234,
      status: "RUNNING",
      stoppedAt,
    });

    const response = await POST(new Request("http://localhost"), context());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ ok: true, id: "worker-new", pid: 4321 });
    expect(mocks.isProcessAlive).toHaveBeenCalledWith(1234);
    expect(mocks.db.backgroundWorkerProcess.update).toHaveBeenCalledWith({
      where: { id: "worker-old" },
      data: { status: "STOPPED", stoppedAt },
    });
    expect(mocks.startWorker).toHaveBeenCalledWith(
      expect.objectContaining({ name: "stream-monitor" }),
      { startedById: "admin-1" },
    );
    expect(
      mocks.db.backgroundWorkerProcess.update.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.startWorker.mock.invocationCallOrder[0]);
  });

  it("clears a legacy zombie row before spawning", async () => {
    mocks.db.backgroundWorkerProcess.findFirst.mockResolvedValue({
      id: "worker-zombie",
      pid: 1234,
      status: "ZOMBIE",
      stoppedAt: null,
    });

    const response = await POST(new Request("http://localhost"), context());

    expect(response.status).toBe(201);
    expect(mocks.isProcessAlive).not.toHaveBeenCalled();
    expect(mocks.db.backgroundWorkerProcess.update).toHaveBeenCalledTimes(1);
    const update = mocks.db.backgroundWorkerProcess.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: "worker-zombie" });
    expect(update.data.status).toBe("STOPPED");
    expect(update.data.stoppedAt).toBeInstanceOf(Date);
    expect(mocks.startWorker).toHaveBeenCalledTimes(1);
  });

  it("returns 409 when the existing worker process is alive", async () => {
    mocks.db.backgroundWorkerProcess.findFirst.mockResolvedValue({
      id: "worker-live",
      pid: 1234,
      status: "RUNNING",
      stoppedAt: null,
    });
    mocks.isProcessAlive.mockReturnValue(true);

    const response = await POST(new Request("http://localhost"), context());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("already running");
    expect(mocks.db.backgroundWorkerProcess.update).not.toHaveBeenCalled();
    expect(mocks.startWorker).not.toHaveBeenCalled();
  });
});
