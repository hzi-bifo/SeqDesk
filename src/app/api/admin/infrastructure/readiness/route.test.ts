import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getResolvedDataBasePath: vi.fn(),
  getExecutionSettings: vi.fn(),
  loadConfig: vi.fn(),
  getServerDeploymentProfile: vi.fn(),
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

vi.mock("@/lib/config/loader", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("@/lib/deployment-profile/server", () => ({
  getServerDeploymentProfile: mocks.getServerDeploymentProfile,
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
    mocks.loadConfig.mockReturnValue({
      config: { pipelines: { enabled: true } },
    });
    mocks.getServerDeploymentProfile.mockReturnValue({
      id: "sequencing-center",
      experience: "sequencing",
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

  it("returns static readiness for demo admins without querying settings", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "demo-1", role: "FACILITY_ADMIN", isDemo: true },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ready: true,
      requiredMissing: [],
      recommendedMissing: [],
      missingItems: [],
      firstMissingHref: "/admin/data-compute",
    });
    expect(mocks.getResolvedDataBasePath).not.toHaveBeenCalled();
    expect(mocks.getExecutionSettings).not.toHaveBeenCalled();
    expect(mocks.loadConfig).not.toHaveBeenCalled();
    expect(mocks.getServerDeploymentProfile).not.toHaveBeenCalled();
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

  it("does not require a workflow runtime when pipelines are disabled for a sequencing profile", async () => {
    mocks.loadConfig.mockReturnValue({
      config: { pipelines: { enabled: false } },
    });
    mocks.getExecutionSettings.mockResolvedValue({
      pipelineRunDir: "",
      condaPath: "",
      weblogUrl: "",
    });

    const response = await GET();
    const body = await response.json();

    expect(body.ready).toBe(true);
    expect(body.requiredMissing).toEqual([]);
    expect(body.recommendedMissing).toEqual([]);
  });

  it("requires workflow execution for an operational Research Workbench", async () => {
    mocks.loadConfig.mockReturnValue({
      config: { pipelines: { enabled: false } },
    });
    mocks.getServerDeploymentProfile.mockReturnValue({
      id: "research-workbench",
      experience: "workbench",
    });

    const response = await GET();
    const body = await response.json();

    expect(body.ready).toBe(false);
    expect(body.requiredMissing).toEqual(["Workflow execution"]);
    expect(body.firstMissingHref).toBe("/admin/settings/pipelines");
    expect(body.recommendedMissing).toEqual([]);
  });

  it("returns 500 when an unexpected error occurs", async () => {
    mocks.getResolvedDataBasePath.mockRejectedValue(new Error("boom"));

    const response = await GET();
    expect(response.status).toBe(500);
  });
});
