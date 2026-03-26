import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFacilityAdminSequencingReadSession: vi.fn(),
  getOrderSequencingSummary: vi.fn(),
}));

vi.mock("@/lib/sequencing/server", () => ({
  requireFacilityAdminSequencingReadSession:
    mocks.requireFacilityAdminSequencingReadSession,
  SequencingApiError: class SequencingApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("@/lib/sequencing/workspace", () => ({
  getOrderSequencingSummary: mocks.getOrderSequencingSummary,
}));

import { GET } from "./route";

const { SequencingApiError } = await import("@/lib/sequencing/server");

const routeContext = { params: Promise.resolve({ id: "order-1" }) };

function makeRequest() {
  return new Request(
    "http://localhost:3000/api/orders/order-1/sequencing"
  );
}

describe("GET /api/orders/[id]/sequencing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFacilityAdminSequencingReadSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
  });

  it("returns custom status on SequencingApiError", async () => {
    mocks.requireFacilityAdminSequencingReadSession.mockRejectedValue(
      new SequencingApiError(401, "Unauthorized")
    );

    const response = await GET(makeRequest(), routeContext);
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 404 when order not found", async () => {
    mocks.getOrderSequencingSummary.mockRejectedValue(
      new Error("Order not found")
    );

    const response = await GET(makeRequest(), routeContext);
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Order not found");
  });

  it("returns summary on success", async () => {
    const summary = { orderId: "order-1", samples: [], status: "ready" };
    mocks.getOrderSequencingSummary.mockResolvedValue(summary);

    const response = await GET(makeRequest(), routeContext);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual(summary);
    expect(mocks.getOrderSequencingSummary).toHaveBeenCalledWith("order-1");
  });

  it("returns 500 on unknown error", async () => {
    mocks.getOrderSequencingSummary.mockRejectedValue(
      new Error("something unexpected")
    );

    const response = await GET(makeRequest(), routeContext);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to load sequencing data");
  });
});
