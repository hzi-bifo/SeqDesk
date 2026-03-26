import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    pipelineRun: {
      findUnique: vi.fn(),
    },
  },
  isDemoSession: vi.fn(),
  getAdapter: vi.fn(),
  registerAdapter: vi.fn(),
  createGenericAdapter: vi.fn(),
  resolveOutputs: vi.fn(),
  saveRunResults: vi.fn(),
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

vi.mock("@/lib/demo/server", () => ({
  isDemoSession: mocks.isDemoSession,
}));

vi.mock("@/lib/pipelines/adapters", () => ({
  getAdapter: mocks.getAdapter,
  registerAdapter: mocks.registerAdapter,
}));

vi.mock("@/lib/pipelines/adapters/mag", () => ({}));

vi.mock("@/lib/pipelines/generic-adapter", () => ({
  createGenericAdapter: mocks.createGenericAdapter,
}));

vi.mock("@/lib/pipelines/output-resolver", () => ({
  resolveOutputs: mocks.resolveOutputs,
  saveRunResults: mocks.saveRunResults,
}));

import { POST } from "./route";

function makeRequest() {
  return new NextRequest(
    "http://localhost:3000/api/pipelines/runs/run-1/resolve-outputs",
    { method: "POST" }
  );
}

const defaultRun = {
  id: "run-1",
  pipelineId: "mag",
  status: "completed",
  runFolder: "/runs/run-1",
  targetType: "order",
  orderId: "order-1",
  studyId: null,
  order: {
    samples: [{ id: "s1", sampleId: "SAMPLE-1" }],
  },
  study: null,
};

const defaultAdapter = {
  discoverOutputs: vi.fn().mockResolvedValue({
    summary: { assemblies: 1 },
  }),
};

describe("POST /api/pipelines/runs/[id]/resolve-outputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "FACILITY_ADMIN" },
    });
    mocks.isDemoSession.mockReturnValue(false);
    mocks.db.pipelineRun.findUnique.mockResolvedValue(defaultRun);
    mocks.getAdapter.mockReturnValue(defaultAdapter);
    mocks.resolveOutputs.mockResolvedValue({
      success: true,
      assembliesCreated: 1,
      binsCreated: 0,
      artifactsCreated: 2,
      errors: [],
      warnings: [],
    });
    mocks.saveRunResults.mockResolvedValue(undefined);
  });

  const params = Promise.resolve({ id: "run-1" });

  it("resolves outputs for a completed run", async () => {
    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.resolved.assembliesCreated).toBe(1);
    expect(mocks.resolveOutputs).toHaveBeenCalledTimes(1);
    expect(mocks.saveRunResults).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(403);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(403);
  });

  it("returns 403 for demo sessions", async () => {
    mocks.isDemoSession.mockReturnValue(true);
    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(403);
  });

  it("returns 404 when run is not found", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue(null);
    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(404);
  });

  it("returns 400 when run status is not completed or failed", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...defaultRun,
      status: "running",
    });
    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("completed or failed");
  });

  it("returns 400 when run folder is not set", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...defaultRun,
      runFolder: null,
    });
    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Run folder not set");
  });

  it("returns 400 when no adapter is found", async () => {
    mocks.getAdapter.mockReturnValue(null);
    mocks.createGenericAdapter.mockReturnValue(null);
    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("No adapter found");
  });

  it("returns 400 when no samples are found", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...defaultRun,
      order: { samples: [] },
    });
    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("No samples found");
  });
});
