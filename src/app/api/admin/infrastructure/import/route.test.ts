import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("fs/promises", () => ({
  default: {
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
  },
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown> = {}) {
  return new NextRequest(
    "http://localhost:3000/api/admin/infrastructure/import",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

describe("POST /api/admin/infrastructure/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      dataBasePath: "/data/seq",
      extraSettings: JSON.stringify({}),
    });
    mocks.db.siteSettings.upsert.mockResolvedValue(undefined);
    mocks.readFile.mockRejectedValue(new Error("ENOENT"));
    mocks.writeFile.mockResolvedValue(undefined);
  });

  it("imports infrastructure settings successfully", async () => {
    const response = await POST(
      makeRequest({
        config: {
          sequencingDataDir: "/data/sequencing",
          pipelineRunDir: "/data/runs",
          condaPath: "/opt/conda",
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.applied.dataBasePath).toBe("/data/sequencing");
    expect(body.applied.pipelineRunDir).toBe("/data/runs");
    expect(body.applied.condaPath).toBe("/opt/conda");
    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);
  });

  it("supports dry run mode", async () => {
    const response = await POST(
      makeRequest({
        dryRun: true,
        config: {
          sequencingDataDir: "/data/sequencing",
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("valid");
    expect(mocks.db.siteSettings.upsert).not.toHaveBeenCalled();
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const response = await POST(
      makeRequest({ config: { pipelineRunDir: "/data/runs" } })
    );

    expect(response.status).toBe(401);
  });

  it("returns 401 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    const response = await POST(
      makeRequest({ config: { pipelineRunDir: "/data/runs" } })
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 when config is not an object", async () => {
    const response = await POST(
      makeRequest({
        config: "not-an-object",
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("JSON object");
  });

  it("returns 400 when no supported settings are found", async () => {
    const response = await POST(
      makeRequest({
        config: {
          unsupportedKey: "value",
        },
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("No supported settings");
  });

  it("parses nested execution settings from pipelines.execution structure", async () => {
    const response = await POST(
      makeRequest({
        config: {
          pipelines: {
            execution: {
              mode: "slurm",
              slurmQueue: "gpu",
              slurmCores: 8,
              slurmMemory: "64GB",
              slurmTimeLimit: 12,
              slurmOptions: "--gres=gpu:1",
              condaPath: "/opt/miniconda",
              condaEnv: "seqdesk",
              nextflowProfile: "test",
              weblogUrl: "http://localhost:3000/api/weblog",
              weblogSecret: "s3cret",
              runDirectory: "/data/pipeline-runs",
              slurm: {
                enabled: true,
              },
            },
          },
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied.useSlurm).toBe(true);
    expect(body.applied.slurmQueue).toBe("gpu");
    expect(body.applied.slurmCores).toBe(8);
    expect(body.applied.slurmMemory).toBe("64GB");
    expect(body.applied.condaPath).toBe("/opt/miniconda");
    expect(body.applied.pipelineRunDir).toBe("/data/pipeline-runs");
    expect(body.applied.nextflowProfile).toBe("test");
    expect(body.applied.weblogUrl).toBe("http://localhost:3000/api/weblog");
    expect(body.applied.weblogSecret).toBe("s3cret");
  });

  it("handles execution mode 'local' to disable slurm", async () => {
    const response = await POST(
      makeRequest({
        config: {
          pipelines: {
            execution: {
              mode: "local",
              condaPath: "/opt/conda",
            },
          },
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied.useSlurm).toBe(false);
    expect(body.applied.condaPath).toBe("/opt/conda");
  });

  it("dry run with port includes warning about restart", async () => {
    const response = await POST(
      makeRequest({
        dryRun: true,
        config: {
          pipelineRunDir: "/data/runs",
          port: 4000,
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(body.warnings[0]).toContain("seqdesk.config.json");
    expect(mocks.db.siteSettings.upsert).not.toHaveBeenCalled();
  });

  it("merges with existing extraSettings from database", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      dataBasePath: "/old/data",
      extraSettings: JSON.stringify({
        pipelineExecution: {
          useSlurm: true,
          slurmQueue: "old-queue",
        },
        otherSetting: "keep-me",
      }),
    });

    const response = await POST(
      makeRequest({
        config: {
          condaPath: "/new/conda",
        },
      })
    );

    expect(response.status).toBe(200);
    const upsertCall = mocks.db.siteSettings.upsert.mock.calls[0][0];
    const extraSettings = JSON.parse(upsertCall.update.extraSettings);
    expect(extraSettings.otherSetting).toBe("keep-me");
    expect(extraSettings.pipelineExecution.condaPath).toBe("/new/conda");
  });

  it("handles malformed extraSettings JSON gracefully", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      dataBasePath: "/data",
      extraSettings: "not-valid-json",
    });

    const response = await POST(
      makeRequest({
        config: {
          condaPath: "/opt/conda",
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied.condaPath).toBe("/opt/conda");
  });

  it("resets pipelineRunDir to default when set to '/'", async () => {
    const response = await POST(
      makeRequest({
        config: {
          pipelineRunDir: "/",
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    // When pipelineRunDir is "/", it falls back to default
    expect(body.applied.pipelineRunDir).toBeDefined();
    expect(body.applied.pipelineRunDir).not.toBe("/");
  });

  it("updates existing config file port and nextAuthUrl", async () => {
    mocks.readFile.mockResolvedValue(
      JSON.stringify({
        app: { port: 3000 },
        runtime: { nextAuthUrl: "http://localhost:3000" },
      })
    );

    const response = await POST(
      makeRequest({
        config: {
          pipelineRunDir: "/data/runs",
          port: 5000,
        },
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    const writtenContent = JSON.parse(mocks.writeFile.mock.calls[0][1]);
    expect(writtenContent.app.port).toBe(5000);
    expect(writtenContent.runtime.nextAuthUrl).toContain("5000");
  });

  it("handles port config file write failure gracefully", async () => {
    mocks.readFile.mockRejectedValue(new Error("ENOENT"));
    mocks.writeFile.mockRejectedValue(new Error("EPERM: permission denied"));

    const response = await POST(
      makeRequest({
        config: {
          pipelineRunDir: "/data/runs",
          port: 4000,
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.warnings.some((w: string) => w.includes("Could not update"))).toBe(true);
  });

  it("creates siteSettings when none exist", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);

    const response = await POST(
      makeRequest({
        config: {
          sequencingDataDir: "/new/data",
        },
      })
    );

    expect(response.status).toBe(200);
    const upsertCall = mocks.db.siteSettings.upsert.mock.calls[0][0];
    expect(upsertCall.create.dataBasePath).toBe("/new/data");
  });

  it("parses boolean values from string representations", async () => {
    const response = await POST(
      makeRequest({
        config: {
          useSlurm: "yes",
          condaPath: "/opt/conda",
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied.useSlurm).toBe(true);
  });

  it("ignores non-positive port and slurmCores values", async () => {
    const response = await POST(
      makeRequest({
        config: {
          port: -1,
          slurmCores: 0,
          condaPath: "/opt/conda",
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied.port).toBeUndefined();
    expect(body.applied.slurmCores).toBeUndefined();
    expect(body.applied.condaPath).toBe("/opt/conda");
  });

  it("handles port config with config file update", async () => {
    mocks.readFile.mockRejectedValue(new Error("ENOENT"));
    mocks.writeFile.mockResolvedValue(undefined);

    const response = await POST(
      makeRequest({
        config: {
          pipelineRunDir: "/data/runs",
          port: 4000,
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied.port).toBe(4000);
    expect(body.warnings.length).toBeGreaterThan(0);
  });
});
