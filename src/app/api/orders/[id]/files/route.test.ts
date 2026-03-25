import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFacilityAdminSequencingSession: vi.fn(),
  getOrderSequencingSummary: vi.fn(),
  getSequencingFilesConfig: vi.fn(),
  checkFileExists: vi.fn(),
  assignOrderSequencingReads: vi.fn(),
}));

vi.mock("@/lib/files", () => ({
  checkFileExists: mocks.checkFileExists,
}));

vi.mock("@/lib/files/sequencing-config", () => ({
  getSequencingFilesConfig: mocks.getSequencingFilesConfig,
}));

vi.mock("@/lib/sequencing/workspace", () => ({
  getOrderSequencingSummary: mocks.getOrderSequencingSummary,
  assignOrderSequencingReads: mocks.assignOrderSequencingReads,
}));

vi.mock("@/lib/sequencing/server", () => {
  class SequencingApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.name = "SequencingApiError";
      this.status = status;
    }
  }

  return {
    requireFacilityAdminSequencingSession: mocks.requireFacilityAdminSequencingSession,
    SequencingApiError,
  };
});

import { GET, PUT } from "./route";

describe("GET /api/orders/[id]/files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFacilityAdminSequencingSession.mockResolvedValue(undefined);
    mocks.getOrderSequencingSummary.mockResolvedValue({
      orderId: "order-1",
      orderName: "Order One",
      orderStatus: "DRAFT",
      canManage: true,
      samples: [
        {
          sampleId: "S1",
          sampleAlias: "Alpha",
          sampleTitle: "Sample One",
          read: {
            file1: "reads/S1_R1.fastq",
            file2: "reads/S1_R2.fastq",
          },
        },
        {
          sampleId: "S2",
          sampleAlias: null,
          sampleTitle: "Sample Two",
          read: null,
        },
      ],
    });
    mocks.getSequencingFilesConfig.mockResolvedValue({
      dataBasePath: "/data/base",
      config: {
        allowedExtensions: [".fastq", ".fq.gz"],
        allowSingleEnd: true,
      },
    });
    mocks.checkFileExists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
  });

  it("returns the legacy order files summary", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "order-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.checkFileExists).toHaveBeenCalledWith("/data/base", "reads/S1_R1.fastq");
    expect(mocks.checkFileExists).toHaveBeenCalledWith("/data/base", "reads/S1_R2.fastq");
    expect(body).toEqual({
      orderId: "order-1",
      orderName: "Order One",
      orderStatus: "DRAFT",
      canAssign: true,
      dataBasePath: "/data/base",
      config: {
        allowedExtensions: [".fastq", ".fq.gz"],
        allowSingleEnd: true,
      },
      samples: [
        {
          sampleId: "S1",
          sampleAlias: "Alpha",
          sampleTitle: "Sample One",
          read1: "reads/S1_R1.fastq",
          read2: "reads/S1_R2.fastq",
          read1Exists: true,
          read2Exists: false,
          suggestedRead1: null,
          suggestedRead2: null,
          suggestionStatus: "assigned",
          suggestionConfidence: 1,
        },
        {
          sampleId: "S2",
          sampleAlias: null,
          sampleTitle: "Sample Two",
          read1: null,
          read2: null,
          read1Exists: false,
          read2Exists: false,
          suggestedRead1: null,
          suggestedRead2: null,
          suggestionStatus: "none",
          suggestionConfidence: 0,
        },
      ],
    });
  });

  it("maps sequencing session and not-found errors", async () => {
    const { SequencingApiError } = await import("@/lib/sequencing/server");
    mocks.requireFacilityAdminSequencingSession.mockRejectedValueOnce(
      new SequencingApiError("Forbidden", 403)
    );

    const forbidden = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "Forbidden" });

    mocks.requireFacilityAdminSequencingSession.mockResolvedValue(undefined);
    mocks.getOrderSequencingSummary.mockRejectedValueOnce(new Error("Order not found"));

    const missing = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Order not found" });
  });
});

describe("PUT /api/orders/[id]/files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFacilityAdminSequencingSession.mockResolvedValue(undefined);
    mocks.assignOrderSequencingReads.mockResolvedValue([
      { sampleId: "S1", success: true },
      { sampleId: "S2", success: false, error: "Missing read 2" },
    ]);
  });

  it("rejects invalid assignment payloads", async () => {
    const response = await PUT(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ assignments: { sampleId: "S1" } }),
      }),
      { params: Promise.resolve({ id: "order-1" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid assignments data",
    });
  });

  it("returns assignment results and overall success", async () => {
    const assignments = [
      {
        sampleId: "S1",
        read1: "reads/S1_R1.fastq",
        read2: "reads/S1_R2.fastq",
      },
      {
        sampleId: "S2",
        read1: "reads/S2_R1.fastq",
        read2: null,
      },
    ];

    const response = await PUT(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ assignments }),
      }),
      { params: Promise.resolve({ id: "order-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.assignOrderSequencingReads).toHaveBeenCalledWith(
      "order-1",
      assignments
    );
    expect(body).toEqual({
      success: false,
      results: [
        { sampleId: "S1", success: true },
        { sampleId: "S2", success: false, error: "Missing read 2" },
      ],
      message: "Assignments saved",
    });
  });

  it("maps sequencing workflow validation errors to 400", async () => {
    mocks.assignOrderSequencingReads.mockRejectedValueOnce(
      new Error("Order is configured as submitted or completed")
    );

    const response = await PUT(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ assignments: [] }),
      }),
      { params: Promise.resolve({ id: "order-1" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Order is configured as submitted or completed",
    });
  });
});
