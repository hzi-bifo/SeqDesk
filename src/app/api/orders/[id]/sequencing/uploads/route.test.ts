import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFacilityAdminSequencingSession: vi.fn(),
  createSequencingUploadSession: vi.fn(),
}));

vi.mock("@/lib/sequencing/server", () => ({
  requireFacilityAdminSequencingSession:
    mocks.requireFacilityAdminSequencingSession,
  SequencingApiError: class SequencingApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("@/lib/sequencing/workspace", () => ({
  createSequencingUploadSession: mocks.createSequencingUploadSession,
}));

import { POST } from "./route";

const { SequencingApiError } = await import("@/lib/sequencing/server");

const routeContext = { params: Promise.resolve({ id: "order-1" }) };

function makeRequest(body: unknown) {
  return new Request(
    "http://localhost:3000/api/orders/order-1/sequencing/uploads",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

const validBody = {
  targetKind: "raw_reads",
  targetRole: "forward",
  originalName: "sample_R1.fastq.gz",
  expectedSize: 1024,
};

describe("POST /api/orders/[id]/sequencing/uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFacilityAdminSequencingSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
  });

  it("returns custom status on SequencingApiError", async () => {
    mocks.requireFacilityAdminSequencingSession.mockRejectedValue(
      new SequencingApiError(401, "Unauthorized")
    );

    const response = await POST(makeRequest(validBody), routeContext);
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 when required fields are missing", async () => {
    const response = await POST(
      makeRequest({ targetKind: "raw_reads" }),
      routeContext
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/required/i);
  });

  it("returns upload session on success", async () => {
    const uploadResult = { uploadId: "up-1", uploadUrl: "/upload/up-1" };
    mocks.createSequencingUploadSession.mockResolvedValue(uploadResult);

    const response = await POST(makeRequest(validBody), routeContext);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.uploadId).toBe("up-1");
    expect(mocks.createSequencingUploadSession).toHaveBeenCalledWith(
      "order-1",
      "admin-1",
      expect.objectContaining({
        targetKind: "raw_reads",
        targetRole: "forward",
        originalName: "sample_R1.fastq.gz",
        expectedSize: 1024,
      })
    );
  });

  it("returns 404 when order not found", async () => {
    mocks.createSequencingUploadSession.mockRejectedValue(
      new Error("Order not found")
    );

    const response = await POST(makeRequest(validBody), routeContext);
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Order not found");
  });

  it("returns 400 for configured/submitted error", async () => {
    mocks.createSequencingUploadSession.mockRejectedValue(
      new Error("Order is already submitted or completed")
    );

    const response = await POST(makeRequest(validBody), routeContext);
    expect(response.status).toBe(400);
  });

  it("returns 500 on unknown error", async () => {
    mocks.createSequencingUploadSession.mockRejectedValue(
      new Error("database down")
    );

    const response = await POST(makeRequest(validBody), routeContext);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to create upload session");
  });
});
