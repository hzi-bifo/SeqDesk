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
  class PrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, { code }: { code: string }) {
      super(message);
      this.code = code;
    }
  }
  return {
    SequencingApiError,
    PrismaClientKnownRequestError,
    requireFacilityAdminSequencingSession: vi.fn(),
    requireFacilityAdminSequencingReadSession: vi.fn(),
    loadMinknowConfig: vi.fn(),
    validateOutputDirUnderRoot: vi.fn(),
    db: {
      streamRun: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      streamRunEvent: {
        create: vi.fn(),
      },
      $transaction: vi.fn(),
    },
  };
});

vi.mock("@/lib/sequencing/server", () => ({
  requireFacilityAdminSequencingSession: mocks.requireFacilityAdminSequencingSession,
  requireFacilityAdminSequencingReadSession:
    mocks.requireFacilityAdminSequencingReadSession,
  SequencingApiError: mocks.SequencingApiError,
}));

vi.mock("@/lib/minknow/config", () => ({
  loadMinknowConfig: mocks.loadMinknowConfig,
}));

vi.mock("@/lib/minknow/security", () => ({
  validateOutputDirUnderRoot: mocks.validateOutputDirUnderRoot,
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@prisma/client", () => ({
  Prisma: {
    PrismaClientKnownRequestError: mocks.PrismaClientKnownRequestError,
    TransactionIsolationLevel: { Serializable: "Serializable" },
  },
}));

import { GET, POST } from "./route";

const baseParams = Promise.resolve({ id: "order-1" });

function makePost(body?: unknown) {
  return new NextRequest("http://localhost:3000/api/orders/order-1/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : "{}",
  });
}

function makeGet() {
  return new NextRequest("http://localhost:3000/api/orders/order-1/stream");
}

describe("POST /api/orders/[id]/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFacilityAdminSequencingSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.loadMinknowConfig.mockResolvedValue({ outputRoot: "/data/minknow" });
    mocks.validateOutputDirUnderRoot.mockResolvedValue({
      ok: true,
      realpath: "/data/minknow/run-a",
    });
    // Default $transaction runs the callback against a tx that proxies to db.
    mocks.db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({
        streamRun: {
          findFirst: mocks.db.streamRun.findFirst,
          create: mocks.db.streamRun.create,
        },
        streamRunEvent: { create: mocks.db.streamRunEvent.create },
      }),
    );
    mocks.db.streamRun.findFirst.mockResolvedValue(null);
    mocks.db.streamRun.create.mockResolvedValue({ id: "run-1" });
    mocks.db.streamRunEvent.create.mockResolvedValue({ id: "evt-1" });
  });

  it("returns 201 and creates a run plus RUN_STARTED event in the txn", async () => {
    const response = await POST(makePost({ outputDir: "/data/minknow/run-a" }), {
      params: baseParams,
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "run-1" });

    expect(mocks.db.streamRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: "order-1",
          outputDir: "/data/minknow/run-a",
          status: "ACTIVE",
        }),
      }),
    );
    expect(mocks.db.streamRunEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          streamRunId: "run-1",
          kind: "RUN_STARTED",
        }),
      }),
    );
    // Transaction runs at SERIALIZABLE isolation.
    expect(mocks.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("returns 400 when outputDir is missing", async () => {
    const response = await POST(makePost({}), { params: baseParams });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "outputDir is required" });
    expect(mocks.validateOutputDirUnderRoot).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("returns 400 when validateOutputDirUnderRoot fails", async () => {
    mocks.validateOutputDirUnderRoot.mockResolvedValue({
      ok: false,
      reason: "outputDir resolves outside root",
    });

    const response = await POST(makePost({ outputDir: "/etc" }), {
      params: baseParams,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "outputDir resolves outside root",
    });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("returns 409 when an ACTIVE stream conflict is thrown inside the txn", async () => {
    mocks.db.streamRun.findFirst.mockResolvedValue({
      id: "other-run",
      orderId: "order-9",
    });

    const response = await POST(makePost({ outputDir: "/data/minknow/run-a" }), {
      params: baseParams,
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("already watching");
    expect(mocks.db.streamRun.create).not.toHaveBeenCalled();
  });

  it("returns 409 when the txn fails with a Prisma P2034 serialization error", async () => {
    mocks.db.$transaction.mockRejectedValue(
      new mocks.PrismaClientKnownRequestError("write conflict", {
        code: "P2034",
      }),
    );

    const response = await POST(makePost({ outputDir: "/data/minknow/run-a" }), {
      params: baseParams,
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("already being started");
  });

  it("maps an auth error to its SequencingApiError status", async () => {
    mocks.requireFacilityAdminSequencingSession.mockRejectedValue(
      new mocks.SequencingApiError(403, "Only facility admins can manage sequencing data"),
    );

    const response = await POST(makePost({ outputDir: "/data/minknow/run-a" }), {
      params: baseParams,
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Only facility admins can manage sequencing data",
    });
  });

  it("lowercases barcodeMap keys and drops non-string values", async () => {
    await POST(
      makePost({
        outputDir: "/data/minknow/run-a",
        barcodeMap: {
          Barcode01: "sample-a",
          BARCODE02: "sample-b",
          barcode03: 123,
          barcode04: "",
        },
      }),
      { params: baseParams },
    );

    const createArg = mocks.db.streamRun.create.mock.calls[0][0];
    const storedMap = JSON.parse(createArg.data.barcodeMap);
    expect(storedMap).toEqual({
      barcode01: "sample-a",
      barcode02: "sample-b",
    });
    // The RUN_STARTED event carries the normalized map too.
    const evtArg = mocks.db.streamRunEvent.create.mock.calls[0][0];
    expect(JSON.parse(evtArg.data.payload).barcodeMap).toEqual({
      barcode01: "sample-a",
      barcode02: "sample-b",
    });
  });

  it("returns 500 on an unexpected error", async () => {
    mocks.db.$transaction.mockRejectedValue(new Error("boom"));

    const response = await POST(makePost({ outputDir: "/data/minknow/run-a" }), {
      params: baseParams,
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to start stream" });
  });
});

describe("GET /api/orders/[id]/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFacilityAdminSequencingReadSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
  });

  it("lists runs for the order", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    mocks.db.streamRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        orderId: "order-1",
        minknowRunId: "mk-1",
        flowCellId: "FC1",
        deviceId: "dev-1",
        outputDir: "/data/minknow/run-a",
        status: "ACTIVE",
        totalBases: BigInt(1000),
        totalReads: 5,
        barcodeMap: JSON.stringify({ barcode01: "sample-a" }),
        startedAt: now,
        lastSeenAt: now,
        stoppedAt: null,
        events: [
          {
            kind: "FILE_INGESTED",
            ts: now,
            payload: JSON.stringify({ barcode: "barcode01" }),
          },
        ],
      },
    ]);

    const response = await GET(makeGet(), { params: baseParams });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({
      id: "run-1",
      orderId: "order-1",
      status: "ACTIVE",
      totalBases: "1000",
      totalReads: 5,
      barcodeMap: { barcode01: "sample-a" },
      stoppedAt: null,
    });
    expect(body.runs[0].latestEvent.kind).toBe("FILE_INGESTED");
    expect(mocks.db.streamRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: "order-1" } }),
    );
  });

  it("maps an auth error to its status", async () => {
    mocks.requireFacilityAdminSequencingReadSession.mockRejectedValue(
      new mocks.SequencingApiError(401, "Unauthorized"),
    );

    const response = await GET(makeGet(), { params: baseParams });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
});
