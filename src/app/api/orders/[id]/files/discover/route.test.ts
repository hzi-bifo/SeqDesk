import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class _SequencingApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    requireFacilityAdminSequencingSession: vi.fn(),
    discoverOrderSequencingFiles: vi.fn(),
    SequencingApiError: _SequencingApiError,
  };
});

vi.mock("@/lib/sequencing/server", () => ({
  requireFacilityAdminSequencingSession: mocks.requireFacilityAdminSequencingSession,
  SequencingApiError: mocks.SequencingApiError,
}));

vi.mock("@/lib/sequencing/workspace", () => ({
  discoverOrderSequencingFiles: mocks.discoverOrderSequencingFiles,
}));

import { POST } from "./route";

function makeRequest(body: unknown) {
  return new Request("http://localhost:3000/api/orders/test-id/files/discover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/orders/[id]/files/discover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFacilityAdminSequencingSession.mockResolvedValue(undefined);
    mocks.discoverOrderSequencingFiles.mockResolvedValue({
      discovered: 5,
      assigned: 3,
    });
  });

  it("returns SequencingApiError status when auth fails", async () => {
    mocks.requireFacilityAdminSequencingSession.mockRejectedValue(
      new mocks.SequencingApiError(401, "Unauthorized")
    );

    const response = await POST(makeRequest({}), {
      params: Promise.resolve({ id: "order-1" }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns SequencingApiError status for forbidden access", async () => {
    mocks.requireFacilityAdminSequencingSession.mockRejectedValue(
      new mocks.SequencingApiError(403, "Forbidden")
    );

    const response = await POST(makeRequest({}), {
      params: Promise.resolve({ id: "order-1" }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  it("discovers files successfully", async () => {
    const response = await POST(makeRequest({ autoAssign: true }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true, discovered: 5, assigned: 3 });
    expect(mocks.discoverOrderSequencingFiles).toHaveBeenCalledWith("order-1", {
      autoAssign: true,
    });
  });

  it("passes force option through", async () => {
    await POST(makeRequest({ force: true }), {
      params: Promise.resolve({ id: "order-1" }),
    });

    expect(mocks.discoverOrderSequencingFiles).toHaveBeenCalledWith("order-1", {
      force: true,
    });
  });

  it("returns 404 when order not found", async () => {
    mocks.discoverOrderSequencingFiles.mockRejectedValue(
      new Error("Order not found")
    );

    const response = await POST(makeRequest({}), {
      params: Promise.resolve({ id: "nonexistent" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Order not found" });
  });

  it("returns 400 when workspace not configured", async () => {
    mocks.discoverOrderSequencingFiles.mockRejectedValue(
      new Error("Workspace not configured")
    );

    const response = await POST(makeRequest({}), {
      params: Promise.resolve({ id: "order-1" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Workspace not configured" });
  });

  it("returns 400 for submitted or completed order", async () => {
    mocks.discoverOrderSequencingFiles.mockRejectedValue(
      new Error("Order must be submitted or completed")
    );

    const response = await POST(makeRequest({}), {
      params: Promise.resolve({ id: "order-1" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Order must be submitted or completed",
    });
  });

  it("returns 500 for unexpected errors", async () => {
    mocks.discoverOrderSequencingFiles.mockRejectedValue(
      new Error("Unexpected DB error")
    );

    const response = await POST(makeRequest({}), {
      params: Promise.resolve({ id: "order-1" }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to discover files" });
  });
});
