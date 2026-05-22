import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFacilityAdminSequencingSession: vi.fn(),
  isDemoSession: vi.fn(),
  buildOrderSequencingDeliverySummary: vi.fn(),
  db: {
    order: {
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/demo/server", () => ({
  isDemoSession: mocks.isDemoSession,
}));

vi.mock("@/lib/sequencing/delivery", () => ({
  buildOrderSequencingDeliverySummary: mocks.buildOrderSequencingDeliverySummary,
}));

vi.mock("@/lib/sequencing/server", () => ({
  requireFacilityAdminSequencingSession: mocks.requireFacilityAdminSequencingSession,
  SequencingApiError: class SequencingApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

import { DELETE, POST } from "./route";

const routeContext = { params: Promise.resolve({ id: "order-1" }) };

function makeDelivery(readFiles = [{ id: "read-1" }], artifactFiles = []) {
  return {
    orderId: "order-1",
    isPublished: false,
    readFiles,
    artifactFiles,
    excluded: {},
  };
}

describe("/api/orders/[id]/sequencing/delivery/publication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFacilityAdminSequencingSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.isDemoSession.mockReturnValue(false);
    mocks.buildOrderSequencingDeliverySummary.mockResolvedValue(makeDelivery());
    mocks.db.order.update.mockResolvedValue({ id: "order-1" });
  });

  it("publishes delivery files for the order owner", async () => {
    const response = await POST(new Request("http://localhost"), routeContext);

    expect(response.status).toBe(200);
    expect(mocks.db.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: {
        sequencingFilesPublishedAt: expect.any(Date),
        sequencingFilesPublishedById: "admin-1",
      },
    });
  });

  it("rejects publication when there are no deliverable files", async () => {
    mocks.buildOrderSequencingDeliverySummary.mockResolvedValue(makeDelivery([], []));

    const response = await POST(new Request("http://localhost"), routeContext);

    expect(response.status).toBe(400);
    expect(mocks.db.order.update).not.toHaveBeenCalled();
  });

  it("clears publication and removes owner access", async () => {
    const response = await DELETE(new Request("http://localhost"), routeContext);

    expect(response.status).toBe(200);
    expect(mocks.db.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: {
        sequencingFilesPublishedAt: null,
        sequencingFilesPublishedById: null,
      },
    });
  });
});
