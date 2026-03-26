import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getResolvedDataBasePath: vi.fn(),
  getExecutionSettings: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/files/data-base-path", () => ({
  getResolvedDataBasePath: mocks.getResolvedDataBasePath,
}));

vi.mock("@/lib/pipelines/execution-settings", () => ({
  getExecutionSettings: mocks.getExecutionSettings,
}));

import { GET } from "./route";

describe("GET /api/admin/infrastructure/readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath: "/data/storage",
    });
    mocks.getExecutionSettings.mockResolvedValue({
      pipelineRunDir: "/data/runs",
      condaPath: "/opt/conda",
      weblogUrl: "https://weblog.example.com",
    });
  });

  it("returns ready=true when all settings are configured", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.requiredMissing).toHaveLength(0);
    expect(body.recommendedMissing).toHaveLength(0);
  });

  it("returns 401 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("reports missing required settings when dataBasePath is empty", async () => {
    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath: "",
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ready).toBe(false);
    expect(body.requiredMissing).toContain("Data storage path");
  });

  it("returns 500 when an unexpected error occurs", async () => {
    mocks.getResolvedDataBasePath.mockRejectedValue(new Error("boom"));

    const response = await GET();
    expect(response.status).toBe(500);
  });
});
