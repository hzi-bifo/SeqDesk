import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  class SequencingApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    SequencingApiError,
    requireFacilityAdminSequencingSession: vi.fn(),
    db: {
      streamRun: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      streamRunEvent: {
        create: vi.fn(),
      },
    },
  };
});

vi.mock("@/lib/sequencing/server", () => ({
  requireFacilityAdminSequencingSession: mocks.requireFacilityAdminSequencingSession,
  SequencingApiError: mocks.SequencingApiError,
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { POST } from "./route";

const params = Promise.resolve({ id: "order-1", streamRunId: "run-1" });

function makeRequest() {
  return new NextRequest(
    "http://localhost:3000/api/orders/order-1/stream/run-1/stop",
    { method: "POST" },
  );
}

describe("POST /api/orders/[id]/stream/[streamRunId]/stop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFacilityAdminSequencingSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.streamRun.findUnique.mockResolvedValue({
      id: "run-1",
      orderId: "order-1",
      status: "ACTIVE",
    });
    mocks.db.streamRun.update.mockResolvedValue({});
    mocks.db.streamRunEvent.create.mockResolvedValue({ id: "evt-1" });
  });

  it("soft-stops an ACTIVE run: sets STOPPING and emits a stop request event", async () => {
    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    expect(mocks.db.streamRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { status: "STOPPING" },
    });
    expect(mocks.db.streamRunEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          streamRunId: "run-1",
          kind: "RUN_STOP_REQUESTED",
        }),
      }),
    );
  });

  it("is idempotent for an already STOPPED run", async () => {
    mocks.db.streamRun.findUnique.mockResolvedValue({
      id: "run-1",
      orderId: "order-1",
      status: "STOPPED",
    });

    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, alreadyStopped: true });
    expect(mocks.db.streamRun.update).not.toHaveBeenCalled();
    expect(mocks.db.streamRunEvent.create).not.toHaveBeenCalled();
  });

  it("is idempotent for a run already STOPPING", async () => {
    mocks.db.streamRun.findUnique.mockResolvedValue({
      id: "run-1",
      orderId: "order-1",
      status: "STOPPING",
    });

    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, alreadyStopping: true });
    expect(mocks.db.streamRun.update).not.toHaveBeenCalled();
    expect(mocks.db.streamRunEvent.create).not.toHaveBeenCalled();
  });

  it("returns 404 when the run is not found", async () => {
    mocks.db.streamRun.findUnique.mockResolvedValue(null);

    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Stream run not found" });
    expect(mocks.db.streamRun.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the run belongs to a different order", async () => {
    mocks.db.streamRun.findUnique.mockResolvedValue({
      id: "run-1",
      orderId: "other-order",
      status: "ACTIVE",
    });

    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(404);
    expect(mocks.db.streamRun.update).not.toHaveBeenCalled();
  });

  it("maps an auth error to its status", async () => {
    mocks.requireFacilityAdminSequencingSession.mockRejectedValue(
      new mocks.SequencingApiError(401, "Unauthorized"),
    );

    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 500 on an unexpected error", async () => {
    mocks.db.streamRun.update.mockRejectedValue(new Error("boom"));

    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to stop stream" });
  });
});
