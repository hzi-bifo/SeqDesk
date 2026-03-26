import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getEffectiveConfig: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({ authOptions: {} }));

vi.mock("@/lib/config", () => ({
  getEffectiveConfig: mocks.getEffectiveConfig,
}));

import { GET } from "./route";

describe("GET /api/admin/config/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
  });

  it("returns config with sensitive values masked", async () => {
    mocks.getEffectiveConfig.mockResolvedValue({
      config: {
        ena: { password: "secret123", webin: "Webin-123" },
        runtime: {
          nextAuthSecret: "s3cret",
          anthropicApiKey: "sk-ant-xxx",
          adminSecret: "admin-pw",
          blobReadWriteToken: "tok-123",
          databaseUrl: "sqlite://test.db",
        },
      },
      sources: { ena: "file", runtime: "env" },
      filePath: "/etc/seqdesk.yaml",
      loadedAt: "2026-01-01T00:00:00Z",
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.config.ena.password).toBe("********");
    expect(body.config.ena.webin).toBe("Webin-123");
    expect(body.config.runtime.nextAuthSecret).toBe("********");
    expect(body.config.runtime.anthropicApiKey).toBe("********");
    expect(body.config.runtime.adminSecret).toBe("********");
    expect(body.config.runtime.blobReadWriteToken).toBe("********");
    expect(body.config.runtime.databaseUrl).toBe("sqlite://test.db");
    expect(body.sources).toEqual({ ena: "file", runtime: "env" });
  });

  it("returns 401 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 500 when config loading fails", async () => {
    mocks.getEffectiveConfig.mockRejectedValue(new Error("file not found"));

    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to load configuration");
  });
});
