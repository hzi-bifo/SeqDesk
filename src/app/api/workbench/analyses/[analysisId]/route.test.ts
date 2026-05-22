import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getWorkbenchAnalysisForUser: vi.fn(),
  updateWorkbenchAnalysis: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/workbench/analyses", () => ({
  getWorkbenchAnalysisForUser: mocks.getWorkbenchAnalysisForUser,
  updateWorkbenchAnalysis: mocks.updateWorkbenchAnalysis,
}));

import { GET, PATCH } from "./route";

const params = { params: Promise.resolve({ analysisId: "analysis-1" }) };

describe("/api/workbench/analyses/[analysisId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getWorkbenchAnalysisForUser.mockResolvedValue({ id: "analysis-1" });
    mocks.updateWorkbenchAnalysis.mockResolvedValue({
      ok: true,
      conflict: false,
      analysis: { id: "analysis-1", revision: 2 },
    });
  });

  it("returns only analyses scoped to the current user", async () => {
    const response = await GET(new Request("http://localhost"), params);

    expect(response.status).toBe(200);
    expect(mocks.getWorkbenchAnalysisForUser).toHaveBeenCalledWith("user-1", "analysis-1");
  });

  it("reports autosave revision conflicts", async () => {
    mocks.updateWorkbenchAnalysis.mockResolvedValue({
      ok: false,
      conflict: true,
      analysis: { id: "analysis-1", revision: 3 },
    });

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          revision: 2,
          name: "Changed",
          canvas: { version: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        }),
      }),
      params
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Workbench analysis changed on the server",
      analysis: { id: "analysis-1", revision: 3 },
    });
  });
});
