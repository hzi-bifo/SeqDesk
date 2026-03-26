import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFacilityAdminSequencingSession: vi.fn(),
  appendSequencingUploadChunk: vi.fn(),
  cancelSequencingUpload: vi.fn(),
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
  appendSequencingUploadChunk: mocks.appendSequencingUploadChunk,
  cancelSequencingUpload: mocks.cancelSequencingUpload,
}));

import { PATCH, DELETE } from "./route";

const { SequencingApiError } = await import("@/lib/sequencing/server");

const routeContext = {
  params: Promise.resolve({ id: "order-1", uploadId: "upload-1" }),
};

function makePatchRequest(
  options: { offset?: string | null; body?: BodyInit | null } = {}
) {
  const headers: Record<string, string> = {};
  if (options.offset !== null && options.offset !== undefined) {
    headers["x-seqdesk-offset"] = options.offset;
  }
  return new Request(
    "http://localhost:3000/api/orders/order-1/sequencing/uploads/upload-1",
    {
      method: "PATCH",
      headers,
      body: options.body !== undefined ? options.body : new Uint8Array([1, 2, 3]),
    }
  );
}

function makeDeleteRequest() {
  return new Request(
    "http://localhost:3000/api/orders/order-1/sequencing/uploads/upload-1",
    { method: "DELETE" }
  );
}

describe("PATCH /api/orders/[id]/sequencing/uploads/[uploadId]", () => {
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

    const response = await PATCH(
      makePatchRequest({ offset: "0" }),
      routeContext
    );
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 when offset header is missing", async () => {
    const response = await PATCH(
      makePatchRequest({ offset: null }),
      routeContext
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/offset/i);
  });

  it("returns 400 when body is missing", async () => {
    // Request with no body - use GET-like request that has no body
    const req = new Request(
      "http://localhost:3000/api/orders/order-1/sequencing/uploads/upload-1",
      {
        method: "PATCH",
        headers: { "x-seqdesk-offset": "0" },
      }
    );

    const response = await PATCH(req, routeContext);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/body/i);
  });

  it("returns result on success", async () => {
    const result = { bytesReceived: 3 };
    mocks.appendSequencingUploadChunk.mockResolvedValue(result);

    const response = await PATCH(
      makePatchRequest({ offset: "0" }),
      routeContext
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.bytesReceived).toBe(3);
    expect(mocks.appendSequencingUploadChunk).toHaveBeenCalledWith(
      "order-1",
      "upload-1",
      BigInt(0),
      expect.anything()
    );
  });

  it("returns 500 on unknown error", async () => {
    mocks.appendSequencingUploadChunk.mockRejectedValue(
      new Error("disk failure")
    );

    const response = await PATCH(
      makePatchRequest({ offset: "0" }),
      routeContext
    );
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to upload chunk");
  });
});

describe("DELETE /api/orders/[id]/sequencing/uploads/[uploadId]", () => {
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

    const response = await DELETE(makeDeleteRequest(), routeContext);
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns success on delete", async () => {
    mocks.cancelSequencingUpload.mockResolvedValue(undefined);

    const response = await DELETE(makeDeleteRequest(), routeContext);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(mocks.cancelSequencingUpload).toHaveBeenCalledWith(
      "order-1",
      "upload-1"
    );
  });

  it("returns 404 when upload not found", async () => {
    mocks.cancelSequencingUpload.mockRejectedValue(
      new Error("Upload not found")
    );

    const response = await DELETE(makeDeleteRequest(), routeContext);
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Upload not found");
  });

  it("returns 500 on unknown error", async () => {
    mocks.cancelSequencingUpload.mockRejectedValue(
      new Error("database down")
    );

    const response = await DELETE(makeDeleteRequest(), routeContext);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to cancel upload");
  });
});
