import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getExecutionSettings: vi.fn(),
  getResolvedDataBasePath: vi.fn(),
  quickPrerequisiteCheck: vi.fn(),
  checkAllPrerequisites: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/pipelines/execution-settings", () => ({
  getExecutionSettings: mocks.getExecutionSettings,
}));

vi.mock("@/lib/files/data-base-path", () => ({
  getResolvedDataBasePath: mocks.getResolvedDataBasePath,
}));

vi.mock("@/lib/pipelines/prerequisite-check", () => ({
  quickPrerequisiteCheck: mocks.quickPrerequisiteCheck,
  checkAllPrerequisites: mocks.checkAllPrerequisites,
}));

import { GET } from "./route";

describe("GET /api/admin/settings/pipelines/check-prerequisites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.getExecutionSettings.mockResolvedValue({
      condaPath: "/opt/conda",
      pipelineRunDir: "/data/runs",
    });
    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath: "/data/base",
    });
  });

  it("returns 403 when not admin", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const request = new Request(
      "http://localhost:3000/api/admin/settings/pipelines/check-prerequisites"
    );
    const response = await GET(request);
    expect(response.status).toBe(403);
  });

  it("returns 403 when no session", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const request = new Request(
      "http://localhost:3000/api/admin/settings/pipelines/check-prerequisites"
    );
    const response = await GET(request);
    expect(response.status).toBe(403);
  });

  it("runs quick check when quick=true", async () => {
    const quickResult = { allPassed: true, checks: [] };
    mocks.quickPrerequisiteCheck.mockResolvedValue(quickResult);

    const request = new Request(
      "http://localhost:3000/api/admin/settings/pipelines/check-prerequisites?quick=true"
    );
    const response = await GET(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual(quickResult);
    expect(mocks.quickPrerequisiteCheck).toHaveBeenCalledWith(
      expect.objectContaining({ condaPath: "/opt/conda" }),
      "/data/base"
    );
    expect(mocks.checkAllPrerequisites).not.toHaveBeenCalled();
  });

  it("runs full check when quick param not set", async () => {
    const fullResult = { allPassed: false, checks: [{ name: "conda", passed: false }] };
    mocks.checkAllPrerequisites.mockResolvedValue(fullResult);

    const request = new Request(
      "http://localhost:3000/api/admin/settings/pipelines/check-prerequisites"
    );
    const response = await GET(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual(fullResult);
    expect(mocks.checkAllPrerequisites).toHaveBeenCalledWith(
      expect.objectContaining({ condaPath: "/opt/conda" }),
      "/data/base"
    );
    expect(mocks.quickPrerequisiteCheck).not.toHaveBeenCalled();
  });

  it("returns 500 on error", async () => {
    mocks.getExecutionSettings.mockRejectedValue(new Error("db failure"));

    const request = new Request(
      "http://localhost:3000/api/admin/settings/pipelines/check-prerequisites"
    );
    const response = await GET(request);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to check prerequisites");
  });
});
