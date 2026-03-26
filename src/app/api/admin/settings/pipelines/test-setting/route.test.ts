import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  testSetting: vi.fn(),
  detectVersions: vi.fn(),
  getExecutionSettings: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/pipelines/prerequisite-check", () => ({
  testSetting: mocks.testSetting,
  detectVersions: mocks.detectVersions,
}));

vi.mock("@/lib/pipelines/execution-settings", () => ({
  getExecutionSettings: mocks.getExecutionSettings,
}));

import { POST, GET } from "./route";

describe("POST /api/admin/settings/pipelines/test-setting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
  });

  it("returns 403 when not admin", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const request = new NextRequest(
      "http://localhost:3000/api/admin/settings/pipelines/test-setting",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ setting: "condaPath", value: "/opt/conda" }),
      }
    );
    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it("returns 400 when setting name is missing", async () => {
    const request = new NextRequest(
      "http://localhost:3000/api/admin/settings/pipelines/test-setting",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "/opt/conda" }),
      }
    );
    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/setting/i);
  });

  it("returns test result on success", async () => {
    const testResult = { valid: true, message: "Conda path is valid" };
    mocks.testSetting.mockResolvedValue(testResult);

    const request = new NextRequest(
      "http://localhost:3000/api/admin/settings/pipelines/test-setting",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ setting: "condaPath", value: "/opt/conda" }),
      }
    );
    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual(testResult);
    expect(mocks.testSetting).toHaveBeenCalledWith("condaPath", "/opt/conda");
  });

  it("returns 500 on error", async () => {
    mocks.testSetting.mockRejectedValue(new Error("test failed"));

    const request = new NextRequest(
      "http://localhost:3000/api/admin/settings/pipelines/test-setting",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ setting: "condaPath", value: "/bad/path" }),
      }
    );
    const response = await POST(request);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to test setting");
  });
});

describe("GET /api/admin/settings/pipelines/test-setting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.getExecutionSettings.mockResolvedValue({
      condaPath: "/opt/conda",
      condaEnv: "seqdesk-pipelines",
    });
  });

  it("returns 403 when not admin", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const response = await GET();
    expect(response.status).toBe(403);
  });

  it("returns versions on success", async () => {
    const versions = { conda: "23.1.0", nextflow: "23.10.0" };
    mocks.detectVersions.mockResolvedValue(versions);

    const response = await GET();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.versions).toEqual(versions);
    expect(mocks.detectVersions).toHaveBeenCalledWith(
      "/opt/conda",
      "seqdesk-pipelines"
    );
  });

  it("returns 500 on error", async () => {
    mocks.getExecutionSettings.mockRejectedValue(new Error("db failure"));

    const response = await GET();
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to detect versions");
  });
});
