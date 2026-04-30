import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireFacilityAdminSequencingReadSession: vi.fn(),
  requireFacilityAdminSequencingSession: vi.fn(),
  listSequencingRunsForOrder: vi.fn(),
  upsertSequencingRunSamples: vi.fn(),
}));

vi.mock("@/lib/sequencing/server", () => {
  class SequencingApiError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.name = "SequencingApiError";
      this.status = status;
    }
  }

  return {
    requireFacilityAdminSequencingReadSession:
      mocks.requireFacilityAdminSequencingReadSession,
    requireFacilityAdminSequencingSession:
      mocks.requireFacilityAdminSequencingSession,
    SequencingApiError,
  };
});

vi.mock("@/lib/sequencing/run-plan", () => ({
  listSequencingRunsForOrder: mocks.listSequencingRunsForOrder,
  upsertSequencingRunSamples: mocks.upsertSequencingRunSamples,
}));

import { GET, POST } from "./route";

function routeParams(id = "order-1", runId = "run-1") {
  return { params: Promise.resolve({ id, runId }) };
}

function jsonRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/orders/order-1/sequencing/runs/run-1/samples", {
    method: "POST",
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("/api/orders/[id]/sequencing/runs/[runId]/samples", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFacilityAdminSequencingReadSession.mockResolvedValue({
      user: { role: "FACILITY_ADMIN" },
    });
    mocks.requireFacilityAdminSequencingSession.mockResolvedValue({
      user: { role: "FACILITY_ADMIN" },
    });
    mocks.listSequencingRunsForOrder.mockResolvedValue({
      fields: [{ name: "depletion", adminOnly: true }],
      runs: [{ id: "run-1", samples: [{ id: "assignment-1" }] }],
    });
    mocks.upsertSequencingRunSamples.mockResolvedValue([{ id: "assignment-1" }]);
  });

  it("requires read permission before returning run samples", async () => {
    const { SequencingApiError } = await import("@/lib/sequencing/server");
    mocks.requireFacilityAdminSequencingReadSession.mockRejectedValueOnce(
      new SequencingApiError(403, "Only facility admins can manage sequencing data")
    );

    const response = await GET(
      new Request("http://localhost") as unknown as NextRequest,
      routeParams()
    );

    expect(response.status).toBe(403);
    expect(mocks.listSequencingRunsForOrder).not.toHaveBeenCalled();
  });

  it("loads samples through order-scoped run listing", async () => {
    const response = await GET(
      new Request("http://localhost") as unknown as NextRequest,
      routeParams("order-1", "run-1")
    );

    expect(response.status).toBe(200);
    expect(mocks.listSequencingRunsForOrder).toHaveBeenCalledWith("order-1", {
      isFacilityAdmin: true,
    });
    expect(await response.json()).toEqual({
      fields: [{ name: "depletion", adminOnly: true }],
      samples: [{ id: "assignment-1" }],
    });
  });

  it("requires write permission before saving assignments", async () => {
    const { SequencingApiError } = await import("@/lib/sequencing/server");
    mocks.requireFacilityAdminSequencingSession.mockRejectedValueOnce(
      new SequencingApiError(403, "Only facility admins can manage sequencing data")
    );

    const response = await POST(
      jsonRequest({ assignments: [] }),
      routeParams()
    );

    expect(response.status).toBe(403);
    expect(mocks.upsertSequencingRunSamples).not.toHaveBeenCalled();
  });

  it("saves assignments through the order-scoped helper", async () => {
    const assignments = [
      { sampleId: "sample-1", barcode: "BC01", customFields: { depletion: "HD" } },
    ];

    const response = await POST(jsonRequest({ assignments }), routeParams());

    expect(response.status).toBe(200);
    expect(mocks.upsertSequencingRunSamples).toHaveBeenCalledWith({
      orderId: "order-1",
      runDbId: "run-1",
      assignments,
    });
    expect(await response.json()).toEqual({
      success: true,
      assignments: [{ id: "assignment-1" }],
    });
  });
});
