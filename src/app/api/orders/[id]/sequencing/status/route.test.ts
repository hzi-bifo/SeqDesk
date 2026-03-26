import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  isDemoSession: vi.fn(),
  setOrderSequencingStatuses: vi.fn(),
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

vi.mock("@/lib/sequencing/workspace", () => ({
  setOrderSequencingStatuses: mocks.setOrderSequencingStatuses,
}));

import { PUT } from "./route";

function makeRequest(body: unknown) {
  return new Request("http://localhost:3000/api/orders/order-1/sequencing/status", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const routeContext = { params: Promise.resolve({ id: "order-1" }) };

describe("PUT /api/orders/[id]/sequencing/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.isDemoSession.mockReturnValue(false);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await PUT(
      makeRequest({ updates: [{ sampleId: "s1", facilityStatus: "DONE" }] }),
      routeContext,
    );

    expect(response.status).toBe(401);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const response = await PUT(
      makeRequest({ updates: [{ sampleId: "s1", facilityStatus: "DONE" }] }),
      routeContext,
    );

    expect(response.status).toBe(403);
  });

  it("returns 400 when updates array is empty", async () => {
    const response = await PUT(
      makeRequest({ updates: [] }),
      routeContext,
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/no status updates/i);
  });

  it("returns 400 when updates is not an array", async () => {
    const response = await PUT(
      makeRequest({ updates: "invalid" }),
      routeContext,
    );

    expect(response.status).toBe(400);
  });

  it("updates sample statuses successfully", async () => {
    const updates = [
      { sampleId: "s1", facilityStatus: "SEQUENCING_COMPLETE" },
      { sampleId: "s2", facilityStatus: "IN_PROGRESS" },
    ];
    mocks.setOrderSequencingStatuses.mockResolvedValue([
      { sampleId: "s1", success: true },
      { sampleId: "s2", success: true },
    ]);

    const response = await PUT(
      makeRequest({ updates }),
      routeContext,
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.results).toHaveLength(2);
    expect(mocks.setOrderSequencingStatuses).toHaveBeenCalledWith("order-1", updates);
  });

  it("returns 404 when order is not found", async () => {
    mocks.setOrderSequencingStatuses.mockRejectedValue(new Error("Order not found"));

    const response = await PUT(
      makeRequest({ updates: [{ sampleId: "s1", facilityStatus: "DONE" }] }),
      routeContext,
    );

    expect(response.status).toBe(404);
  });
});
