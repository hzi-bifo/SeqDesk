import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    pipelineRun: {
      findUnique: vi.fn(),
    },
    pipelineRunEvent: {
      findMany: vi.fn(),
    },
  },
  getExecutionSettings: vi.fn(),
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

vi.mock("@/lib/pipelines/execution-settings", () => ({
  getExecutionSettings: mocks.getExecutionSettings,
}));

import { GET } from "./route";

const defaultRun = {
  id: "run-1",
  runNumber: 1,
  pipelineId: "mag",
  study: { userId: "study-owner" },
  order: { userId: "order-owner" },
};

const defaultEvents = [
  {
    id: "evt-1",
    eventType: "process_completed",
    processName: "FASTQC",
    stepId: "step-1",
    status: "completed",
    message: "Done",
    payload: '{"exit_code":0}',
    source: "nextflow",
    occurredAt: new Date("2024-01-01T00:00:00Z"),
  },
];

function makeRequest(params?: Record<string, string>) {
  const url = new URL("http://localhost:3000/api/pipelines/runs/run-1/weblog");
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url.toString());
}

describe("GET /api/pipelines/runs/[id]/weblog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValue(defaultRun);
    mocks.db.pipelineRunEvent.findMany.mockResolvedValue(defaultEvents);
    mocks.getExecutionSettings.mockResolvedValue({ weblogSecret: null });
  });

  const params = Promise.resolve({ id: "run-1" });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(401);
  });

  it("returns 404 when run is not found", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue(null);
    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(404);
  });

  it("returns 403 for non-admin non-owner user", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "other-user", role: "RESEARCHER" },
    });
    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(403);
  });

  it("returns 200 for admin user", async () => {
    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.run.id).toBe("run-1");
    expect(body.events).toHaveLength(1);
  });

  it("returns 200 for study owner", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "study-owner", role: "RESEARCHER" },
    });
    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(200);
  });

  it("returns 200 for order owner", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "order-owner", role: "RESEARCHER" },
    });
    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(200);
  });

  it("uses default limit of 100 when no limit param", async () => {
    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(200);
    expect(mocks.db.pipelineRunEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 })
    );
  });

  it("uses custom limit param", async () => {
    const response = await GET(makeRequest({ limit: "50" }), { params });

    expect(response.status).toBe(200);
    expect(mocks.db.pipelineRunEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 })
    );
  });

  it("caps limit at 500", async () => {
    const response = await GET(makeRequest({ limit: "9999" }), { params });

    expect(response.status).toBe(200);
    expect(mocks.db.pipelineRunEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 })
    );
  });

  it("falls back to default limit for invalid value", async () => {
    const response = await GET(makeRequest({ limit: "abc" }), { params });

    expect(response.status).toBe(200);
    expect(mocks.db.pipelineRunEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 })
    );
  });

  it("parses event payload as JSON when valid", async () => {
    mocks.db.pipelineRunEvent.findMany.mockResolvedValue([
      {
        ...defaultEvents[0],
        payload: '{"exit_code":0}',
      },
    ]);

    const response = await GET(makeRequest(), { params });
    const body = await response.json();

    expect(body.events[0].payload).toEqual({ exit_code: 0 });
    expect(body.events[0].payloadRaw).toBe('{"exit_code":0}');
  });

  it("keeps event payload as string when invalid JSON", async () => {
    mocks.db.pipelineRunEvent.findMany.mockResolvedValue([
      {
        ...defaultEvents[0],
        payload: "not-json",
      },
    ]);

    const response = await GET(makeRequest(), { params });
    const body = await response.json();

    expect(body.events[0].payload).toBe("not-json");
    expect(body.events[0].payloadRaw).toBe("not-json");
  });

  it("includes token info in webhook endpoint when secret is set", async () => {
    mocks.getExecutionSettings.mockResolvedValue({
      weblogSecret: "my-secret",
    });

    const response = await GET(makeRequest(), { params });
    const body = await response.json();

    expect(body.webhook.tokenRequired).toBe(true);
    expect(body.webhook.endpoint).toContain("token=");
  });

  it("does not include token when no secret is set", async () => {
    mocks.getExecutionSettings.mockResolvedValue({ weblogSecret: null });

    const response = await GET(makeRequest(), { params });
    const body = await response.json();

    expect(body.webhook.tokenRequired).toBe(false);
    expect(body.webhook.endpoint).not.toContain("token=");
  });

  it("returns 500 on db error", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.db.pipelineRun.findUnique.mockRejectedValue(
      new Error("db failure")
    );

    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(500);
    consoleError.mockRestore();
  });
});
