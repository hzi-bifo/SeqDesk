import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getPipelineDefinition: vi.fn(),
  getPipelineDag: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({ authOptions: {} }));

vi.mock("@/lib/pipelines/definitions", () => ({
  getPipelineDefinition: mocks.getPipelineDefinition,
  getPipelineDag: mocks.getPipelineDag,
}));

import { GET } from "./route";

describe("GET /api/pipelines/definitions/[id]", () => {
  const callGET = (id: string) =>
    GET(
      new NextRequest(`http://localhost:3000/api/pipelines/definitions/${id}`),
      { params: Promise.resolve({ id }) }
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
  });

  it("returns definition and DAG for a valid pipeline", async () => {
    mocks.getPipelineDefinition.mockReturnValue({
      pipeline: "fastqc",
      name: "FastQC",
      description: "Quality control",
      version: "0.12.1",
      url: "https://example.com/fastqc",
    });
    mocks.getPipelineDag.mockReturnValue({
      nodes: [{ id: "n1", label: "FastQC" }],
      edges: [],
    });

    const res = await callGET("fastqc");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.definition).toEqual({
      id: "fastqc",
      name: "FastQC",
      description: "Quality control",
      version: "0.12.1",
      url: "https://example.com/fastqc",
    });
    expect(body.nodes).toHaveLength(1);
    expect(body.edges).toHaveLength(0);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const res = await callGET("fastqc");
    expect(res.status).toBe(401);
  });

  it("returns 404 when definition is not found", async () => {
    mocks.getPipelineDefinition.mockReturnValue(null);
    mocks.getPipelineDag.mockReturnValue(null);

    const res = await callGET("nonexistent");
    expect(res.status).toBe(404);
  });

  it("returns 500 on unexpected error", async () => {
    mocks.getPipelineDefinition.mockImplementation(() => {
      throw new Error("parse error");
    });

    const res = await callGET("broken");
    expect(res.status).toBe(500);
  });
});
