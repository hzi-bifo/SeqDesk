import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  assertSequencingDeliveryAccess: vi.fn(),
  buildOrderSequencingDeliverySummary: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/sequencing/delivery", () => ({
  assertSequencingDeliveryAccess: mocks.assertSequencingDeliveryAccess,
  buildOrderSequencingDeliverySummary: mocks.buildOrderSequencingDeliverySummary,
}));

import { GET } from "./route";

const routeContext = { params: Promise.resolve({ id: "order-1" }) };

describe("GET /api/orders/[id]/sequencing/delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.assertSequencingDeliveryAccess.mockResolvedValue(null);
    mocks.buildOrderSequencingDeliverySummary.mockResolvedValue({
      orderId: "order-1",
      isPublished: true,
      readFiles: [],
      artifactFiles: [],
      excluded: {},
    });
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost"), routeContext);

    expect(response.status).toBe(401);
  });

  it("returns access errors from the delivery gate", async () => {
    mocks.assertSequencingDeliveryAccess.mockResolvedValue({
      status: 403,
      body: { error: "Sequencing files are not available for this sequencing order" },
    });

    const response = await GET(new Request("http://localhost"), routeContext);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Sequencing files are not available for this sequencing order",
    });
    expect(mocks.buildOrderSequencingDeliverySummary).not.toHaveBeenCalled();
  });

  it("returns delivery candidates for authorized callers", async () => {
    const response = await GET(new Request("http://localhost"), routeContext);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      delivery: {
        orderId: "order-1",
        isPublished: true,
      },
    });
    expect(mocks.buildOrderSequencingDeliverySummary).toHaveBeenCalledWith("order-1");
  });
});
