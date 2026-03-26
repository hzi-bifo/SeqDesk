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
