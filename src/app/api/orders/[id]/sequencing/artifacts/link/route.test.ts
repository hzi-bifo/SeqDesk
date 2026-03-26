import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFacilityAdminSequencingSession: vi.fn(),
  linkOrderSequencingArtifact: vi.fn(),
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
  linkOrderSequencingArtifact: mocks.linkOrderSequencingArtifact,
}));

import { POST } from "./route";

const { SequencingApiError } = await import("@/lib/sequencing/server");

const routeContext = { params: Promise.resolve({ id: "order-1" }) };

function makeRequest(body: unknown) {
  return new Request(
    "http://localhost:3000/api/orders/order-1/sequencing/artifacts/link",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

const validBody = {
  stage: "raw",
  artifactType: "fastq",
  path: "/data/sample_R1.fastq.gz",
};

describe("POST /api/orders/[id]/sequencing/artifacts/link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFacilityAdminSequencingSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
  });

  it("returns custom status on SequencingApiError", async () => {
    mocks.requireFacilityAdminSequencingSession.mockRejectedValue(
      new SequencingApiError(403, "Forbidden")
    );

    const response = await POST(makeRequest(validBody), routeContext);
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Forbidden");
  });

  it("returns 400 when required fields are missing", async () => {
    const response = await POST(
      makeRequest({ stage: "raw" }),
      routeContext
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/required/i);
  });

  it("returns artifact on success", async () => {
    const artifact = { id: "art-1", path: "/data/sample_R1.fastq.gz" };
    mocks.linkOrderSequencingArtifact.mockResolvedValue(artifact);

    const response = await POST(makeRequest(validBody), routeContext);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.artifact).toEqual(artifact);
    expect(mocks.linkOrderSequencingArtifact).toHaveBeenCalledWith(
      "order-1",
      expect.objectContaining({
        stage: "raw",
        artifactType: "fastq",
        path: "/data/sample_R1.fastq.gz",
        createdById: "admin-1",
      })
    );
  });

  it("returns 404 when order not found", async () => {
    mocks.linkOrderSequencingArtifact.mockRejectedValue(
      new Error("Order not found")
    );

    const response = await POST(makeRequest(validBody), routeContext);
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Order not found");
  });

  it("returns 400 for configured/required error", async () => {
    mocks.linkOrderSequencingArtifact.mockRejectedValue(
      new Error("Sequencing not configured for this order")
    );

    const response = await POST(makeRequest(validBody), routeContext);
    expect(response.status).toBe(400);
  });

  it("returns 500 on unknown error", async () => {
    mocks.linkOrderSequencingArtifact.mockRejectedValue(
      new Error("database down")
    );

    const response = await POST(makeRequest(validBody), routeContext);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to link sequencing artifact");
  });
});
