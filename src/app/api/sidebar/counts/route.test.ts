import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    order: {
      count: vi.fn(),
    },
    study: {
      count: vi.fn(),
    },
    read: {
      count: vi.fn(),
    },
    submission: {
      count: vi.fn(),
    },
    pipelineRun: {
      count: vi.fn(),
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

import { GET } from "./route";

describe("GET /api/sidebar/counts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "USER",
        isDemo: false,
      },
    });
    mocks.db.order.count.mockResolvedValue(4);
    mocks.db.study.count.mockResolvedValue(3);
    mocks.db.read.count.mockResolvedValue(12);
    mocks.db.submission.count.mockResolvedValue(5);
    mocks.db.pipelineRun.count.mockResolvedValue(2);
  });

  it("rejects requests without a session", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("uses owner-scoped counts for regular users", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.db.order.count).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(mocks.db.study.count).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(mocks.db.read.count).not.toHaveBeenCalled();
    expect(mocks.db.submission.count).not.toHaveBeenCalled();
    expect(mocks.db.pipelineRun.count).toHaveBeenCalledWith({
      where: {
        status: { in: ["pending", "queued", "running"] },
        study: { userId: "user-1" },
      },
    });
    expect(body).toEqual({
      orders: 4,
      studies: 3,
      files: 0,
      submissions: 0,
      analysis: 2,
    });
  });

  it("uses unrestricted admin counts and suppresses analysis for demo users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
        isDemo: true,
      },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.db.order.count).toHaveBeenCalledWith({ where: {} });
    expect(mocks.db.study.count).toHaveBeenCalledWith({ where: {} });
    expect(mocks.db.read.count).toHaveBeenCalledTimes(1);
    expect(mocks.db.submission.count).toHaveBeenCalledTimes(1);
    expect(mocks.db.pipelineRun.count).not.toHaveBeenCalled();
    expect(body).toEqual({
      orders: 4,
      studies: 3,
      files: 12,
      submissions: 5,
      analysis: 0,
    });
  });
});
