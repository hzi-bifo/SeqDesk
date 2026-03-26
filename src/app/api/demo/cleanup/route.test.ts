import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  cleanupExpiredDemoWorkspaces: vi.fn(),
}));

vi.mock("@/lib/demo/server", () => ({
  cleanupExpiredDemoWorkspaces: mocks.cleanupExpiredDemoWorkspaces,
}));

import { GET } from "./route";

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/demo/cleanup", {
    headers,
  });
}

describe("GET /api/demo/cleanup", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    mocks.cleanupExpiredDemoWorkspaces.mockResolvedValue({
      cleaned: 3,
      remaining: 5,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("allows access in non-production when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.DEMO_CLEANUP_SECRET;
    process.env.NODE_ENV = "development";

    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
  });

  it("returns 401 when secret is configured but not provided", async () => {
    process.env.CRON_SECRET = "my-secret";

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when wrong secret is provided", async () => {
    process.env.CRON_SECRET = "my-secret";

    const response = await GET(
      makeRequest({ authorization: "Bearer wrong-secret" })
    );

    expect(response.status).toBe(401);
  });

  it("allows access with correct CRON_SECRET", async () => {
    process.env.CRON_SECRET = "my-secret";

    const response = await GET(
      makeRequest({ authorization: "Bearer my-secret" })
    );

    expect(response.status).toBe(200);
  });

  it("allows access with correct DEMO_CLEANUP_SECRET", async () => {
    process.env.DEMO_CLEANUP_SECRET = "demo-secret";

    const response = await GET(
      makeRequest({ authorization: "Bearer demo-secret" })
    );

    expect(response.status).toBe(200);
  });

  it("prefers CRON_SECRET over DEMO_CLEANUP_SECRET", async () => {
    process.env.CRON_SECRET = "cron-secret";
    process.env.DEMO_CLEANUP_SECRET = "demo-secret";

    const okResponse = await GET(
      makeRequest({ authorization: "Bearer cron-secret" })
    );
    expect(okResponse.status).toBe(200);

    const failResponse = await GET(
      makeRequest({ authorization: "Bearer demo-secret" })
    );
    expect(failResponse.status).toBe(401);
  });

  it("returns cleanup result on success", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.DEMO_CLEANUP_SECRET;
    process.env.NODE_ENV = "development";

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ cleaned: 3, remaining: 5 });
  });

  it("sets no-cache headers", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.DEMO_CLEANUP_SECRET;
    process.env.NODE_ENV = "development";

    const response = await GET(makeRequest());

    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
  });

  it("returns 500 with error message when cleanup throws Error", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.DEMO_CLEANUP_SECRET;
    process.env.NODE_ENV = "development";
    mocks.cleanupExpiredDemoWorkspaces.mockRejectedValue(
      new Error("Database connection failed")
    );

    const response = await GET(makeRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Database connection failed",
    });
  });

  it("returns 500 with generic message for non-Error throws", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.DEMO_CLEANUP_SECRET;
    process.env.NODE_ENV = "development";
    mocks.cleanupExpiredDemoWorkspaces.mockRejectedValue("string error");

    const response = await GET(makeRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to clean up demo workspaces" });
  });

  it("returns 401 in production when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.DEMO_CLEANUP_SECRET;
    process.env.NODE_ENV = "production";

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
  });
});
