import { beforeEach, describe, expect, it, vi } from "vitest";

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

function makeRequest() {
  return new Request(
    "http://localhost:3000/api/orders/order-1/stream/run-1/by-barcode",
  );
}

function ingestEvent(ts: string, payload: Record<string, unknown> | null) {
  return { ts: new Date(ts), payload: payload === null ? null : JSON.stringify(payload) };
}

describe("GET /api/orders/[id]/stream/[streamRunId]/by-barcode", () => {
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

  it("aggregates FILE_INGESTED events per barcode, sorted by barcode", async () => {
    mocks.db.streamRunEvent.findMany.mockResolvedValue([
      ingestEvent("2026-01-01T00:00:01.000Z", {
        barcode: "barcode02",
        size: 100,
        reads: 10,
        bases: 1000,
        filePath: "/p/b2-1.fastq",
      }),
      ingestEvent("2026-01-01T00:00:02.000Z", {
        barcode: "barcode01",
        size: 50,
        reads: 5,
        bases: 500,
        filePath: "/p/b1-1.fastq",
      }),
      ingestEvent("2026-01-01T00:00:03.000Z", {
        barcode: "barcode01",
        size: 70,
        reads: 7,
        bases: 700,
        filePath: "/p/b1-2.fastq",
      }),
    ]);

    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(200);
    const body = await response.json();
    // Sorted by barcode ascending.
    expect(body.barcodes.map((r: { barcode: string }) => r.barcode)).toEqual([
      "barcode01",
      "barcode02",
    ]);
    const b1 = body.barcodes[0];
    expect(b1).toMatchObject({
      barcode: "barcode01",
      fileCount: 2,
      totalSize: 120,
      totalReads: 12,
      totalBases: 1200,
      lastFilePath: "/p/b1-2.fastq",
    });
    expect(b1.lastFileAt).toBe("2026-01-01T00:00:03.000Z");

    expect(mocks.db.streamRunEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { streamRunId: "run-1", kind: "FILE_INGESTED" },
      }),
    );
  });

  it("buckets missing/invalid barcodes under (unknown) and tolerates bad payloads", async () => {
    mocks.db.streamRunEvent.findMany.mockResolvedValue([
      ingestEvent("2026-01-01T00:00:01.000Z", { size: 10, reads: 1, bases: 100 }),
      { ts: new Date("2026-01-01T00:00:02.000Z"), payload: "not-json{{{" },
      { ts: new Date("2026-01-01T00:00:03.000Z"), payload: null },
    ]);

    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.barcodes).toHaveLength(1);
    expect(body.barcodes[0]).toMatchObject({
      barcode: "(unknown)",
      fileCount: 1,
      totalSize: 10,
    });
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
      new mocks.SequencingApiError(403, "Only facility admins can manage sequencing data"),
    );

    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Only facility admins can manage sequencing data",
    });
  });

  it("returns 500 on an unexpected error", async () => {
    mocks.db.streamRun.findUnique.mockRejectedValue(new Error("boom"));

    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to aggregate barcodes" });
  });
});
