import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    pipelineRun: {
      findMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { getPipelineLoadSummary } from "./pipeline-load";

const now = new Date("2026-05-19T10:00:00.000Z");
const fresh = new Date("2026-05-19T09:56:00.000Z");
const stale = new Date("2026-05-19T09:40:00.000Z");

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    runNumber: "RUN-1",
    pipelineId: "mag",
    status: "running",
    targetType: "study",
    study: { title: "Metagenomics Study" },
    order: null,
    executionMode: null,
    executionProfile: null,
    queueJobId: null,
    queueStatus: null,
    queueReason: null,
    userId: "user-1",
    startedAt: fresh,
    queuedAt: null,
    queueUpdatedAt: null,
    lastEventAt: null,
    lastTraceAt: null,
    createdAt: fresh,
    updatedAt: fresh,
    ...overrides,
  };
}

describe("getPipelineLoadSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.user.findMany.mockResolvedValue([
      {
        id: "user-1",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
      },
      {
        id: "user-2",
        firstName: "",
        lastName: "",
        email: "max@example.com",
      },
    ]);
  });

  it("counts normalized active pipeline runs by status, execution mode, stale state, and user", async () => {
    mocks.db.pipelineRun.findMany.mockResolvedValue([
      run({ status: "queued", executionMode: "slurm", queueJobId: "12345" }),
      run({ status: "running", executionMode: "local", queueJobId: "local-4242" }),
      run({ status: "pending", userId: "user-2", updatedAt: stale }),
      run({ status: "running", userId: "user-2", queueJobId: "55555" }),
      run({ status: "completed", userId: "user-2", queueJobId: "99999" }),
    ]);

    const summary = await getPipelineLoadSummary({ now });

    expect(mocks.db.pipelineRun.findMany).toHaveBeenCalledWith({
      where: { status: { in: ["pending", "queued", "running"] } },
      select: {
        id: true,
        runNumber: true,
        pipelineId: true,
        status: true,
        targetType: true,
        study: { select: { title: true } },
        order: { select: { name: true, orderNumber: true } },
        executionMode: true,
        executionProfile: true,
        queueJobId: true,
        queueStatus: true,
        queueReason: true,
        userId: true,
        startedAt: true,
        queuedAt: true,
        queueUpdatedAt: true,
        lastEventAt: true,
        lastTraceAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(mocks.db.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["user-1", "user-2"] } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
    });
    expect(summary.totalActive).toBe(4);
    expect(summary.statuses).toEqual({ pending: 1, queued: 1, running: 2 });
    expect(summary.modes).toEqual({ slurm: 2, local: 1, unknown: 1 });
    expect(summary.staleActive).toBe(1);
    expect(summary.staleByStatus).toEqual({ pending: 1, queued: 0, running: 0 });
    expect(summary.visibleUsers).toEqual([
      {
        userId: "user-1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        active: 2,
        staleActive: 0,
        statuses: { pending: 0, queued: 1, running: 1 },
        staleByStatus: { pending: 0, queued: 0, running: 0 },
        modes: { slurm: 1, local: 1, unknown: 0 },
      },
      {
        userId: "user-2",
        name: "max@example.com",
        email: "max@example.com",
        active: 2,
        staleActive: 1,
        statuses: { pending: 1, queued: 0, running: 1 },
        staleByStatus: { pending: 1, queued: 0, running: 0 },
        modes: { slurm: 1, local: 0, unknown: 1 },
      },
    ]);
    expect(summary.users).toEqual(summary.visibleUsers);
    expect(summary.totalUsers).toBe(2);
    expect(summary.hiddenUserCount).toBe(0);
    expect(summary.activeRuns).toHaveLength(4);
    expect(summary.hiddenRunCount).toBe(0);
    expect(summary.updatedAt).toBe(now.toISOString());
  });

  it("includes visible active run timing and requested SLURM resources", async () => {
    mocks.db.pipelineRun.findMany.mockResolvedValue([
      run({
        id: "run-slurm",
        runNumber: "MAG-20260519-001",
        pipelineId: "mag",
        executionMode: "slurm",
        executionProfile: JSON.stringify({
          mode: "slurm",
          slurm: {
            queue: "bigmem",
            cores: 24,
            memory: "256GB",
            timeLimit: 48,
          },
        }),
        queueJobId: "12345",
        queueStatus: "RUNNING",
        queueReason: "None",
        startedAt: new Date("2026-05-19T08:30:00.000Z"),
        queuedAt: new Date("2026-05-19T08:00:00.000Z"),
        updatedAt: stale,
        order: { name: "RNA order", orderNumber: "ORD-1" },
        study: null,
      }),
      run({
        id: "run-local",
        runNumber: "FASTQC-20260519-001",
        pipelineId: "fastqc",
        executionMode: "local",
        queueJobId: "local-1",
        startedAt: new Date("2026-05-19T09:45:00.000Z"),
      }),
    ]);

    const summary = await getPipelineLoadSummary({ now });

    expect(summary.activeRuns[0]).toMatchObject({
      id: "run-slurm",
      runNumber: "MAG-20260519-001",
      pipelineId: "mag",
      targetLabel: "ORD-1",
      mode: "slurm",
      queueJobId: "12345",
      queueStatus: "RUNNING",
      queueReason: "None",
      activeSince: "2026-05-19T08:30:00.000Z",
      stale: true,
      resources: {
        queue: "bigmem",
        cores: 24,
        memory: "256GB",
        timeLimitHours: 48,
      },
    });
    expect(summary.activeRuns[1]).toMatchObject({
      id: "run-local",
      mode: "local",
      resources: null,
    });
  });

  it("infers only strict local and SLURM-like queue ids", async () => {
    mocks.db.pipelineRun.findMany.mockResolvedValue([
      run({ queueJobId: "local-111" }),
      run({ executionMode: "slurm", queueJobId: null }),
      run({ queueJobId: "12345" }),
      run({ queueJobId: "12345.cluster" }),
      run({ queueJobId: "12345_7" }),
      run({ queueJobId: "abc123" }),
    ]);

    const summary = await getPipelineLoadSummary({ now });

    expect(summary.totalActive).toBe(6);
    expect(summary.modes).toEqual({ slurm: 4, local: 1, unknown: 1 });
  });

  it("uses queue, event, trace, then updated timestamps for stale detection", async () => {
    mocks.db.pipelineRun.findMany.mockResolvedValue([
      run({ status: "pending", queueUpdatedAt: stale, lastEventAt: fresh, updatedAt: fresh }),
      run({ status: "queued", lastEventAt: stale, lastTraceAt: fresh, updatedAt: fresh }),
      run({ status: "running", lastTraceAt: stale, updatedAt: fresh }),
      run({ status: "running", updatedAt: stale }),
    ]);

    const summary = await getPipelineLoadSummary({ now });

    expect(summary.staleActive).toBe(4);
    expect(summary.staleByStatus).toEqual({ pending: 1, queued: 1, running: 2 });
  });

  it("falls back cleanly when a run user cannot be loaded", async () => {
    mocks.db.pipelineRun.findMany.mockResolvedValue([
      run({ userId: "missing-user", status: "running" }),
    ]);
    mocks.db.user.findMany.mockResolvedValue([]);

    const summary = await getPipelineLoadSummary({ now });

    expect(summary.visibleUsers).toEqual([
      expect.objectContaining({
        userId: "missing-user",
        name: "Unknown user",
        email: null,
        active: 1,
      }),
    ]);
  });

  it("truncates visible users and reports the hidden count", async () => {
    mocks.db.pipelineRun.findMany.mockResolvedValue([
      run({ userId: "user-1" }),
      run({ userId: "user-2" }),
      run({ userId: "user-3" }),
    ]);
    mocks.db.user.findMany.mockResolvedValue([
      { id: "user-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
      { id: "user-2", firstName: "Max", lastName: "Planck", email: "max@example.com" },
      { id: "user-3", firstName: "Grace", lastName: "Hopper", email: "grace@example.com" },
    ]);

    const summary = await getPipelineLoadSummary({ now, visibleUserLimit: 2 });

    expect(summary.totalUsers).toBe(3);
    expect(summary.visibleUsers).toHaveLength(2);
    expect(summary.hiddenUserCount).toBe(1);
  });

  it("returns empty counts without loading users when there are no active runs", async () => {
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);

    const summary = await getPipelineLoadSummary({ now });

    expect(mocks.db.user.findMany).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      totalActive: 0,
      statuses: { pending: 0, queued: 0, running: 0 },
      modes: { slurm: 0, local: 0, unknown: 0 },
      staleActive: 0,
      staleByStatus: { pending: 0, queued: 0, running: 0 },
      totalUsers: 0,
      visibleUsers: [],
      hiddenUserCount: 0,
    });
  });
});
