import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getExecutionSettings: vi.fn(),
  saveExecutionSettings: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/pipelines/execution-settings", () => ({
  DEFAULT_EXECUTION_SETTINGS: {
    useSlurm: false,
    slurmQueue: "cpu",
    slurmCores: 4,
    slurmMemory: "64GB",
    slurmTimeLimit: 12,
    slurmOptions: "",
    runtimeMode: "conda",
    condaPath: "",
    condaEnv: "seqdesk-pipelines",
    nextflowProfile: "",
    pipelineRunDir: "/data/pipeline_runs",
    weblogUrl: "",
    weblogSecret: "",
  },
  getExecutionSettings: mocks.getExecutionSettings,
  saveExecutionSettings: mocks.saveExecutionSettings,
}));

import { GET, POST } from "./route";

describe("GET /api/admin/settings/pipelines/execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.getExecutionSettings.mockResolvedValue({
      useSlurm: false,
      pipelineRunDir: "/data/runs",
    });
  });

  it("returns execution settings for admin", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.settings.pipelineRunDir).toBe("/data/runs");
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const response = await GET();
    expect(response.status).toBe(403);
  });
});

describe("POST /api/admin/settings/pipelines/execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.saveExecutionSettings.mockResolvedValue(undefined);
  });

  it("saves valid execution settings", async () => {
    const request = new NextRequest(
      "http://localhost/api/admin/settings/pipelines/execution",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          useSlurm: true,
          slurmQueue: "gpu",
          pipelineRunDir: "/data/runs",
        }),
      }
    );

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.settings.useSlurm).toBe(true);
    expect(body.settings.slurmQueue).toBe("gpu");
    expect(mocks.saveExecutionSettings).toHaveBeenCalledTimes(1);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const request = new NextRequest(
      "http://localhost/api/admin/settings/pipelines/execution",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }
    );

    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it("returns 500 when save fails", async () => {
    mocks.saveExecutionSettings.mockRejectedValue(new Error("disk full"));

    const request = new NextRequest(
      "http://localhost/api/admin/settings/pipelines/execution",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pipelineRunDir: "/data/runs" }),
      }
    );

    const response = await POST(request);
    expect(response.status).toBe(500);
  });
});
