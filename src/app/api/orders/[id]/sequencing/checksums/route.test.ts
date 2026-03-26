import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFacilityAdminSequencingSession: vi.fn(),
  computeOrderSequencingChecksums: vi.fn(),
}));

vi.mock("@/lib/sequencing/workspace", () => ({
  computeOrderSequencingChecksums: mocks.computeOrderSequencingChecksums,
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

describe("POST /api/orders/[id]/sequencing/checksums", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.requireFacilityAdminSequencingSession.mockResolvedValue({
      user: { id: "admin-1" },
    });
    mocks.computeOrderSequencingChecksums.mockResolvedValue({
      computed: 5,
      skipped: 0,
    });
  });

  it("returns checksum summary on success", async () => {
    const body = { readIds: ["read-1", "read-2"] };

    const response = await POST(
      new Request("http://localhost/api/orders/order-1/sequencing/checksums", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      orderParams()
    );

    expect(response.status).toBe(200);
    expect(mocks.computeOrderSequencingChecksums).toHaveBeenCalledWith(
      "order-1",
      body
    );
    expect(await response.json()).toEqual({
      success: true,
      summary: { computed: 5, skipped: 0 },
    });
  });

  it("returns 401 when not authenticated", async () => {
    const { SequencingApiError } = await import("@/lib/sequencing/server");

    mocks.requireFacilityAdminSequencingSession.mockRejectedValueOnce(
      new SequencingApiError("Unauthorized", 401)
    );

    const response = await POST(
      new Request("http://localhost/api/orders/order-1/sequencing/checksums", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      orderParams()
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 400 for order-level errors", async () => {
    mocks.computeOrderSequencingChecksums.mockRejectedValueOnce(
      new Error("Order not configured")
    );

    const response = await POST(
      new Request("http://localhost/api/orders/order-1/sequencing/checksums", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      orderParams()
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Order not configured" });
  });

  it("returns 500 for unexpected errors", async () => {
    mocks.computeOrderSequencingChecksums.mockRejectedValueOnce(
      new Error("disk failure")
    );

    const response = await POST(
      new Request("http://localhost/api/orders/order-1/sequencing/checksums", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      orderParams()
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to compute sequencing checksums",
    });
  });
});
