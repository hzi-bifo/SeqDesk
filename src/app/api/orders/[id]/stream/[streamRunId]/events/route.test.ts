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
    requireFacilityAdminSequencingReadSession: vi.fn(),
    db: {
      streamRun: {
        findUnique: vi.fn(),
      },
      streamRunEvent: {
        findMany: vi.fn(),
      },
    },
  };
});

vi.mock("@/lib/sequencing/server", () => ({
  requireFacilityAdminSequencingReadSession:
    mocks.requireFacilityAdminSequencingReadSession,
  SequencingApiError: mocks.SequencingApiError,
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { GET } from "./route";

const params = Promise.resolve({ id: "order-1", streamRunId: "run-1" });

function makeRequest(query = "") {
  return new NextRequest(
    `http://localhost:3000/api/orders/order-1/stream/run-1/events${query}`,
  );
}

function makeEvent(seq: number) {
  return {
    id: `evt-${seq}`,
    seq,
    ts: new Date("2026-01-01T00:00:00.000Z"),
    kind: "FILE_INGESTED",
    payload: JSON.stringify({ n: seq }),
  };
}

describe("GET /api/orders/[id]/stream/[streamRunId]/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFacilityAdminSequencingReadSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.streamRun.findUnique.mockResolvedValue({
      id: "run-1",
      orderId: "order-1",
    });
    mocks.db.streamRunEvent.findMany.mockResolvedValue([]);
  });

  it("defaults take to 100 when limit is non-numeric (?limit=abc)", async () => {
    await GET(makeRequest("?limit=abc"), { params });

    const arg = mocks.db.streamRunEvent.findMany.mock.calls[0][0];
    expect(arg.take).toBe(100);
  });

  it("defaults take to 100 when limit is negative (?limit=-5)", async () => {
    await GET(makeRequest("?limit=-5"), { params });

    const arg = mocks.db.streamRunEvent.findMany.mock.calls[0][0];
    expect(arg.take).toBe(100);
  });

  it("caps take at 500 when limit is huge (?limit=99999)", async () => {
    await GET(makeRequest("?limit=99999"), { params });

    const arg = mocks.db.streamRunEvent.findMany.mock.calls[0][0];
    expect(arg.take).toBe(500);
  });

  it("honors a valid limit within range", async () => {
    await GET(makeRequest("?limit=25"), { params });

    const arg = mocks.db.streamRunEvent.findMany.mock.calls[0][0];
    expect(arg.take).toBe(25);
  });

  it("with no cursor queries newest-first (desc) and no seq filter", async () => {
    mocks.db.streamRunEvent.findMany.mockResolvedValue([
      makeEvent(10),
      makeEvent(9),
      makeEvent(8),
    ]);

    const response = await GET(makeRequest(), { params });

    const arg = mocks.db.streamRunEvent.findMany.mock.calls[0][0];
    expect(arg.orderBy).toEqual({ seq: "desc" });
    expect(arg.where).toEqual({ streamRunId: "run-1" });

    const body = await response.json();
    // Newest-first, cursor is the highest seq returned (first element).
    expect(body.events.map((e: { seq: number }) => e.seq)).toEqual([10, 9, 8]);
    expect(body.cursor).toBe(10);
  });

  it("with ?after=N uses seq:{gt:N} asc, then reverses to newest-first with cursor = max seq", async () => {
    // DB returns oldest-first (asc) when a cursor is present.
    mocks.db.streamRunEvent.findMany.mockResolvedValue([
      makeEvent(6),
      makeEvent(7),
      makeEvent(8),
    ]);

    const response = await GET(makeRequest("?after=5"), { params });

    const arg = mocks.db.streamRunEvent.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ streamRunId: "run-1", seq: { gt: 5 } });
    expect(arg.orderBy).toEqual({ seq: "asc" });

    const body = await response.json();
    // Response is reversed to newest-first.
    expect(body.events.map((e: { seq: number }) => e.seq)).toEqual([8, 7, 6]);
    expect(body.cursor).toBe(8);
  });

  it("with ?after=N and no new rows keeps the cursor at N", async () => {
    mocks.db.streamRunEvent.findMany.mockResolvedValue([]);

    const response = await GET(makeRequest("?after=42"), { params });

    const body = await response.json();
    expect(body.events).toEqual([]);
    expect(body.cursor).toBe(42);
  });

  it("returns cursor 0 when no cursor and no events", async () => {
    mocks.db.streamRunEvent.findMany.mockResolvedValue([]);

    const response = await GET(makeRequest(), { params });

    const body = await response.json();
    expect(body.cursor).toBe(0);
  });

  it("returns 404 when the run is not found", async () => {
    mocks.db.streamRun.findUnique.mockResolvedValue(null);

    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Stream run not found" });
    expect(mocks.db.streamRunEvent.findMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the run belongs to a different order", async () => {
    mocks.db.streamRun.findUnique.mockResolvedValue({
      id: "run-1",
      orderId: "other-order",
    });

    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(404);
    expect(mocks.db.streamRunEvent.findMany).not.toHaveBeenCalled();
  });

  it("maps an auth error to its status", async () => {
    mocks.requireFacilityAdminSequencingReadSession.mockRejectedValue(
      new mocks.SequencingApiError(401, "Unauthorized"),
    );

    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 500 on an unexpected error", async () => {
    mocks.db.streamRun.findUnique.mockRejectedValue(new Error("boom"));

    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load events" });
  });
});
