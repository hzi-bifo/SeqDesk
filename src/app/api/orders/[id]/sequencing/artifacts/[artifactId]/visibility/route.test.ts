import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFacilityAdminSequencingSession: vi.fn(),
  db: {
    sequencingArtifact: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
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

import { PATCH } from "./route";

const routeContext = {
  params: Promise.resolve({ id: "order-1", artifactId: "artifact-1" }),
};

describe("PATCH /api/orders/[id]/sequencing/artifacts/[artifactId]/visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFacilityAdminSequencingSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.sequencingArtifact.findFirst.mockResolvedValue({ id: "artifact-1" });
    mocks.db.sequencingArtifact.update.mockResolvedValue({
      id: "artifact-1",
      orderId: "order-1",
      sampleId: null,
      sequencingRunId: null,
      stage: "qc",
      artifactType: "qc_report",
      source: "manual",
      visibility: "customer",
      path: "reports/customer.html",
      originalName: "customer.html",
      size: BigInt(123),
      checksum: null,
      mimeType: "text/html",
      metadata: null,
      createdAt: new Date("2026-05-22T10:00:00.000Z"),
      updatedAt: new Date("2026-05-22T10:00:00.000Z"),
    });
  });

  it("rejects invalid visibility values", async () => {
    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ visibility: "public" }),
      }),
      routeContext
    );

    expect(response.status).toBe(400);
    expect(mocks.db.sequencingArtifact.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the artifact is not part of the order", async () => {
    mocks.db.sequencingArtifact.findFirst.mockResolvedValue(null);

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ visibility: "customer" }),
      }),
      routeContext
    );

    expect(response.status).toBe(404);
  });

  it("marks reports as customer-facing", async () => {
    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ visibility: "customer" }),
      }),
      routeContext
    );

    expect(response.status).toBe(200);
    expect(mocks.db.sequencingArtifact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "artifact-1" },
        data: { visibility: "customer" },
      })
    );
    await expect(response.json()).resolves.toMatchObject({
      artifact: {
        id: "artifact-1",
        visibility: "customer",
        size: 123,
      },
    });
  });
});
