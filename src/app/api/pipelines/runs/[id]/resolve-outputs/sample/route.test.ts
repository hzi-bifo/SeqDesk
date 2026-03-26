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
}));

import { POST } from "./route";

const defaultRun = {
  id: "run-1",
  pipelineId: "mag",
  status: "completed",
  runFolder: "/runs/run-1",
  targetType: "order",
  orderId: "order-1",
  studyId: null,
  order: {
    samples: [
      { id: "sample-1", sampleId: "SAMPLE-1" },
      { id: "sample-2", sampleId: "SAMPLE-2" },
    ],
  },
  study: null,
};

const defaultAdapter = {
  discoverOutputs: vi.fn().mockResolvedValue({
    files: [
      {
        sampleId: "sample-1",
        filePath: "/runs/run-1/output/sample1.fastq",
        metadata: {},
      },
      {
        sampleId: "sample-2",
        filePath: "/runs/run-1/output/sample2.fastq",
        metadata: {},
      },
    ],
    summary: {},
  }),
};

function makeRequest(body: Record<string, unknown> = { sampleId: "sample-1" }) {
  return new NextRequest(
    "http://localhost:3000/api/pipelines/runs/run-1/resolve-outputs/sample",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

describe("POST /api/pipelines/runs/[id]/resolve-outputs/sample", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.isDemoSession.mockReturnValue(false);
    mocks.db.pipelineRun.findUnique.mockResolvedValue(defaultRun);
    mocks.getAdapter.mockReturnValue(defaultAdapter);
    mocks.createGenericAdapter.mockReturnValue(null);
    mocks.resolveOutputs.mockResolvedValue({
      success: true,
      errors: [],
    });
  });

  const params = Promise.resolve({ id: "run-1" });

  it("returns 403 when not admin", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(403);
  });

  it("returns 403 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(403);
  });

  it("returns 403 for demo session", async () => {
    mocks.isDemoSession.mockReturnValue(true);
    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(403);
  });

  it("returns 400 when sampleId is missing", async () => {
    const response = await POST(makeRequest({}), { params });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Missing sampleId");
  });

  it("returns 400 when sampleId is not a string", async () => {
    const response = await POST(makeRequest({ sampleId: 123 }), { params });

    expect(response.status).toBe(400);
  });

  it("returns 404 when run is not found", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue(null);
    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(404);
  });

  it("returns 400 when run is not completed or failed", async () => {
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

  it("returns 400 when sample is not in the run", async () => {
    const response = await POST(
      makeRequest({ sampleId: "nonexistent" }),
      { params }
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Sample not found");
  });

  it("returns 400 when no adapter is found", async () => {
    mocks.getAdapter.mockReturnValue(null);
    mocks.createGenericAdapter.mockReturnValue(null);
    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("No adapter found");
  });

  it("returns 404 when no outputs found for sample", async () => {
    const adapterNoOutputs = {
      discoverOutputs: vi.fn().mockResolvedValue({
        files: [
          {
            sampleId: "sample-2",
            filePath: "/runs/run-1/output/sample2.fastq",
            metadata: {},
          },
        ],
        summary: {},
      }),
    };
    mocks.getAdapter.mockReturnValue(adapterNoOutputs);

    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain("No outputs found for this sample");
  });

  it("resolves outputs successfully with adapter", async () => {
    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.errors).toEqual([]);
    expect(mocks.resolveOutputs).toHaveBeenCalledTimes(1);

    // Verify filtered files have replaceExisting set
    const resolveCall = mocks.resolveOutputs.mock.calls[0];
    expect(resolveCall[2].files).toHaveLength(1);
    expect(resolveCall[2].files[0].sampleId).toBe("sample-1");
    expect(resolveCall[2].files[0].metadata.replaceExisting).toBe(true);
  });

  it("falls back to generic adapter when primary adapter not found", async () => {
    const genericAdapter = {
      discoverOutputs: vi.fn().mockResolvedValue({
        files: [
          {
            sampleId: "sample-1",
            filePath: "/runs/run-1/output/sample1.fastq",
            metadata: {},
          },
        ],
        summary: {},
      }),
    };
    mocks.getAdapter.mockReturnValue(null);
    mocks.createGenericAdapter.mockReturnValue(genericAdapter);

    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(200);
    expect(mocks.registerAdapter).toHaveBeenCalledWith(genericAdapter);
    expect(genericAdapter.discoverOutputs).toHaveBeenCalled();
  });

  it("resolves outputs for study-targeted run", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...defaultRun,
      targetType: "study",
      orderId: null,
      studyId: "study-1",
      order: null,
      study: {
        samples: [
          { id: "sample-1", sampleId: "SAMPLE-1" },
          { id: "sample-2", sampleId: "SAMPLE-2" },
        ],
      },
    });

    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(200);
  });

  it("returns 500 on unexpected error", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.db.pipelineRun.findUnique.mockRejectedValue(
      new Error("db failure")
    );

    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(500);
    consoleError.mockRestore();
  });
});
