import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFacilityAdminSequencingSession: vi.fn(),
  discoverOrderSequencingFiles: vi.fn(),
}));

vi.mock("@/lib/sequencing/workspace", () => ({
  discoverOrderSequencingFiles: mocks.discoverOrderSequencingFiles,
}));

vi.mock("@/lib/sequencing/server", () => {
  class SequencingApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.name = "SequencingApiError";
      this.status = status;
    }
  }

  return {
    requireFacilityAdminSequencingSession:
      mocks.requireFacilityAdminSequencingSession,
    SequencingApiError,
  };
});

import { POST } from "./route";

function orderParams(id = "order-1") {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/orders/[id]/sequencing/discover", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.requireFacilityAdminSequencingSession.mockResolvedValue({
      user: { id: "admin-1" },
    });
    mocks.discoverOrderSequencingFiles.mockResolvedValue({
      discovered: 3,
      assigned: 2,
    });
  });

  it("returns discovery result on success", async () => {
    const body = { autoAssign: true, force: false };

    const response = await POST(
      new Request("http://localhost/api/orders/order-1/sequencing/discover", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      orderParams()
    );

    expect(response.status).toBe(200);
    expect(mocks.discoverOrderSequencingFiles).toHaveBeenCalledWith(
      "order-1",
      body
    );
    expect(await response.json()).toEqual({
      success: true,
      discovered: 3,
      assigned: 2,
    });
  });

  it("returns 401 when not authenticated", async () => {
    const { SequencingApiError } = await import("@/lib/sequencing/server");

    mocks.requireFacilityAdminSequencingSession.mockRejectedValueOnce(
      new SequencingApiError("Unauthorized", 401)
    );

    const response = await POST(
      new Request("http://localhost/api/orders/order-1/sequencing/discover", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      orderParams()
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 404 when order is not found", async () => {
    mocks.discoverOrderSequencingFiles.mockRejectedValueOnce(
      new Error("Order not found")
    );

    const response = await POST(
      new Request("http://localhost/api/orders/order-1/sequencing/discover", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      orderParams()
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Order not found" });
  });

  it("returns 400 for order configuration errors", async () => {
    mocks.discoverOrderSequencingFiles.mockRejectedValueOnce(
      new Error("Order is configured as submitted or completed")
    );

    const response = await POST(
      new Request("http://localhost/api/orders/order-1/sequencing/discover", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      orderParams()
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Order is configured as submitted or completed",
    });
  });

  it("returns 500 for unexpected errors", async () => {
    mocks.discoverOrderSequencingFiles.mockRejectedValueOnce(
      new Error("disk failure")
    );

    const response = await POST(
      new Request("http://localhost/api/orders/order-1/sequencing/discover", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      orderParams()
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to discover sequencing files",
    });
  });
});
