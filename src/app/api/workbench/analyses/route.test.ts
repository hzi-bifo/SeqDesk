import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  listWorkbenchAnalyses: vi.fn(),
  createWorkbenchAnalysis: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/workbench/analyses", () => ({
  listWorkbenchAnalyses: mocks.listWorkbenchAnalyses,
  createWorkbenchAnalysis: mocks.createWorkbenchAnalysis,
}));

import { GET, POST } from "./route";

describe("/api/workbench/analyses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.listWorkbenchAnalyses.mockResolvedValue([{ id: "analysis-1" }]);
    mocks.createWorkbenchAnalysis.mockResolvedValue({ id: "analysis-2" });
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    expect((await GET()).status).toBe(401);
    expect((await POST(new Request("http://localhost"))).status).toBe(401);
  });

  it("lists current-user analyses", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.listWorkbenchAnalyses).toHaveBeenCalledWith("user-1");
    expect(await response.json()).toEqual({ analyses: [{ id: "analysis-1" }] });
  });

  it("creates a new analysis for the current user", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ name: "New analysis" }),
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.createWorkbenchAnalysis).toHaveBeenCalledWith({
      userId: "user-1",
      name: "New analysis",
      description: null,
    });
  });
});
