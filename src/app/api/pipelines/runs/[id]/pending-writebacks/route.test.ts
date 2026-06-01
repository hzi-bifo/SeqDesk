import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  isDemoSession: vi.fn(),
  listPendingWritebacks: vi.fn(),
  promotePendingWritebacks: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/demo/server", () => ({
  isDemoSession: mocks.isDemoSession,
}));

vi.mock("@/lib/pipelines/pending-writebacks", () => ({
  listPendingWritebacks: mocks.listPendingWritebacks,
  promotePendingWritebacks: mocks.promotePendingWritebacks,
}));

import { GET, POST } from "./route";

const baseParams = Promise.resolve({ id: "run-1" });

function makeRequest(body?: unknown, method = "POST") {
  return new NextRequest(
    "http://localhost:3000/api/pipelines/runs/run-1/pending-writebacks",
    {
      method,
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }
  );
}

const adminSession = { user: { id: "admin-1", role: "FACILITY_ADMIN" } };

const summary = {
  run: {
    id: "run-1",
    runNumber: "RUN-001",
    pipelineId: "host-filter",
    status: "completed",
    orderId: "order-1",
  },
  readCandidates: [],
  reports: [],
  review: { title: "Review pending read outputs" },
};

describe("GET /api/pipelines/runs/[id]/pending-writebacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.isDemoSession.mockReturnValue(false);
    mocks.listPendingWritebacks.mockResolvedValue(summary);
  });

  it("returns 403 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET(makeRequest(undefined, "GET"), {
      params: baseParams,
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.listPendingWritebacks).not.toHaveBeenCalled();
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const response = await GET(makeRequest(undefined, "GET"), {
      params: baseParams,
    });

    expect(response.status).toBe(403);
    expect(mocks.listPendingWritebacks).not.toHaveBeenCalled();
  });

  it("returns the summary from listPendingWritebacks on the happy path", async () => {
    const response = await GET(makeRequest(undefined, "GET"), {
      params: baseParams,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(summary);
    expect(mocks.listPendingWritebacks).toHaveBeenCalledWith("run-1");
  });

  it("returns 404 when the run is not found", async () => {
    mocks.listPendingWritebacks.mockRejectedValue(
      new Error("Pipeline run not found")
    );

    const response = await GET(makeRequest(undefined, "GET"), {
      params: baseParams,
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain("not found");
  });

  it("returns 400 on other library errors", async () => {
    mocks.listPendingWritebacks.mockRejectedValue(
      new Error("Pending read promotion requires an order-scoped run")
    );

    const response = await GET(makeRequest(undefined, "GET"), {
      params: baseParams,
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("order-scoped");
  });
});

describe("POST /api/pipelines/runs/[id]/pending-writebacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.isDemoSession.mockReturnValue(false);
    mocks.promotePendingWritebacks.mockResolvedValue({
      promoted: 1,
      readIds: ["read-cleaned"],
    });
  });

  it("returns 403 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST(makeRequest({ sampleIds: ["sample-1"] }), {
      params: baseParams,
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.promotePendingWritebacks).not.toHaveBeenCalled();
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const response = await POST(makeRequest({ sampleIds: ["sample-1"] }), {
      params: baseParams,
    });

    expect(response.status).toBe(403);
    expect(mocks.promotePendingWritebacks).not.toHaveBeenCalled();
  });

  it("returns 403 for demo sessions", async () => {
    mocks.isDemoSession.mockReturnValue(true);

    const response = await POST(makeRequest({ sampleIds: ["sample-1"] }), {
      params: baseParams,
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain("demo");
    expect(mocks.promotePendingWritebacks).not.toHaveBeenCalled();
  });

  it("promotes selected candidates and returns the library result", async () => {
    const response = await POST(makeRequest({ sampleIds: ["sample-1"] }), {
      params: baseParams,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      promoted: 1,
      readIds: ["read-cleaned"],
    });
    expect(mocks.promotePendingWritebacks).toHaveBeenCalledWith({
      runId: "run-1",
      sampleIds: ["sample-1"],
      userId: "admin-1",
    });
  });

  it("passes undefined sampleIds when none are provided", async () => {
    const response = await POST(makeRequest({}), { params: baseParams });

    expect(response.status).toBe(200);
    expect(mocks.promotePendingWritebacks).toHaveBeenCalledWith({
      runId: "run-1",
      sampleIds: undefined,
      userId: "admin-1",
    });
  });

  it("filters non-string sampleIds out of the request body", async () => {
    const response = await POST(
      makeRequest({ sampleIds: ["sample-1", 123, null, "sample-2"] }),
      { params: baseParams }
    );

    expect(response.status).toBe(200);
    expect(mocks.promotePendingWritebacks).toHaveBeenCalledWith({
      runId: "run-1",
      sampleIds: ["sample-1", "sample-2"],
      userId: "admin-1",
    });
  });

  it("tolerates a missing/invalid JSON body", async () => {
    const request = new NextRequest(
      "http://localhost:3000/api/pipelines/runs/run-1/pending-writebacks",
      { method: "POST" }
    );

    const response = await POST(request, { params: baseParams });

    expect(response.status).toBe(200);
    expect(mocks.promotePendingWritebacks).toHaveBeenCalledWith({
      runId: "run-1",
      sampleIds: undefined,
      userId: "admin-1",
    });
  });

  it("returns 404 when the run is not found", async () => {
    mocks.promotePendingWritebacks.mockRejectedValue(
      new Error("Pipeline run not found")
    );

    const response = await POST(makeRequest({ sampleIds: ["sample-1"] }), {
      params: baseParams,
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain("not found");
  });

  it("returns 400 on other promotion errors", async () => {
    mocks.promotePendingWritebacks.mockRejectedValue(
      new Error("Read candidate is outside the run folder: /etc/passwd")
    );

    const response = await POST(makeRequest({ sampleIds: ["sample-1"] }), {
      params: baseParams,
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("outside the run folder");
  });
});
