import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFacilityAdminSequencingSession: vi.fn(),
  completeSequencingUpload: vi.fn(),
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
  completeSequencingUpload: mocks.completeSequencingUpload,
}));

import { POST } from "./route";

const { SequencingApiError } = await import("@/lib/sequencing/server");

const routeContext = {
  params: Promise.resolve({ id: "order-1", uploadId: "upload-1" }),
};

function makeRequest() {
  return new Request(
    "http://localhost:3000/api/orders/order-1/sequencing/uploads/upload-1/complete",
    { method: "POST" }
  );
}

describe("POST /api/orders/[id]/sequencing/uploads/[uploadId]/complete", () => {
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

    const response = await POST(makeRequest(), routeContext);
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns result on success", async () => {
    const result = { artifactId: "art-1", checksum: "abc123" };
    mocks.completeSequencingUpload.mockResolvedValue(result);

    const response = await POST(makeRequest(), routeContext);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.artifactId).toBe("art-1");
    expect(mocks.completeSequencingUpload).toHaveBeenCalledWith(
      "order-1",
      "upload-1"
    );
  });

  it("returns 400 for not found/incomplete/require errors", async () => {
    mocks.completeSequencingUpload.mockRejectedValue(
      new Error("Upload not found")
    );

    const response = await POST(makeRequest(), routeContext);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Upload not found");
  });

  it("returns 400 for incomplete upload", async () => {
    mocks.completeSequencingUpload.mockRejectedValue(
      new Error("Upload incomplete - missing chunks")
    );

    const response = await POST(makeRequest(), routeContext);
    expect(response.status).toBe(400);
  });

  it("returns 400 for require error", async () => {
    mocks.completeSequencingUpload.mockRejectedValue(
      new Error("Checksum required but not provided")
    );

    const response = await POST(makeRequest(), routeContext);
    expect(response.status).toBe(400);
  });

  it("returns 500 on unknown error", async () => {
    mocks.completeSequencingUpload.mockRejectedValue(
      new Error("database down")
    );

    const response = await POST(makeRequest(), routeContext);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to finalize upload");
  });
});
