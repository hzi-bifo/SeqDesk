import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  validatePipelineMetadata: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/pipelines/metadata-validation", () => ({
  validatePipelineMetadata: mocks.validatePipelineMetadata,
}));

import { POST } from "./route";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/pipelines/validate-metadata", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/pipelines/validate-metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "FACILITY_ADMIN" },
    });
    mocks.validatePipelineMetadata.mockResolvedValue({
      valid: true,
      errors: [],
    });
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST(makeRequest({ studyId: "s1", pipelineId: "p1" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 400 when neither studyId nor orderId provided", async () => {
    const response = await POST(makeRequest({ pipelineId: "p1" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "pipelineId and exactly one of studyId or orderId are required",
    });
  });

  it("returns 400 when both studyId and orderId provided", async () => {
    const response = await POST(
      makeRequest({ studyId: "s1", orderId: "o1", pipelineId: "p1" })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "pipelineId and exactly one of studyId or orderId are required",
    });
  });

  it("returns 400 when pipelineId is missing", async () => {
    const response = await POST(makeRequest({ studyId: "s1" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "pipelineId and exactly one of studyId or orderId are required",
    });
  });

  it("returns 400 when sampleIds is not an array", async () => {
    const response = await POST(
      makeRequest({ studyId: "s1", pipelineId: "p1", sampleIds: "not-array" })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "sampleIds must be an array of strings",
    });
  });

  it("returns 400 when sampleIds contains non-strings", async () => {
    const response = await POST(
      makeRequest({ studyId: "s1", pipelineId: "p1", sampleIds: [1, 2, 3] })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "sampleIds must be an array of strings",
    });
  });

  it("validates with studyId and returns result", async () => {
    const validationResult = { valid: true, errors: [], warnings: [] };
    mocks.validatePipelineMetadata.mockResolvedValue(validationResult);

    const response = await POST(
      makeRequest({ studyId: "s1", pipelineId: "p1" })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(validationResult);
    expect(mocks.validatePipelineMetadata).toHaveBeenCalledWith(
      { type: "study", studyId: "s1", sampleIds: undefined },
      "p1",
    );
  });

  it("validates with orderId and returns result", async () => {
    const response = await POST(
      makeRequest({ orderId: "o1", pipelineId: "p1" })
    );

    expect(response.status).toBe(200);
    expect(mocks.validatePipelineMetadata).toHaveBeenCalledWith(
      { type: "order", orderId: "o1", sampleIds: undefined },
      "p1",
    );
  });

  it("passes sampleIds through when provided", async () => {
    const response = await POST(
      makeRequest({
        studyId: "s1",
        pipelineId: "p1",
        sampleIds: ["sample-a", "sample-b"],
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.validatePipelineMetadata).toHaveBeenCalledWith(
      { type: "study", studyId: "s1", sampleIds: ["sample-a", "sample-b"] },
      "p1",
    );
  });

  it("returns 500 when validatePipelineMetadata throws", async () => {
    mocks.validatePipelineMetadata.mockRejectedValue(new Error("DB error"));

    const response = await POST(
      makeRequest({ studyId: "s1", pipelineId: "p1" })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to validate metadata" });
  });
});
