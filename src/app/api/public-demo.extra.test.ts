import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = {
  get: vi.fn(),
};

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  normalizeDemoExperience: vi.fn(),
  authorizeDemoWorkspaceToken: vi.fn(),
  bootstrapDemoWorkspace: vi.fn(),
  createDemoSessionToken: vi.fn(),
  getAuthSessionCookieName: vi.fn(),
  getAuthSessionCookieOptions: vi.fn(),
  getDemoCookieOptions: vi.fn(),
  getDemoWorkspaceCookieName: vi.fn(),
  resetDemoWorkspace: vi.fn(),
  cleanupExpiredDemoWorkspaces: vi.fn(),
  getDefaultTechSyncUrl: vi.fn(),
  parseTechConfig: vi.fn(),
  withResolvedTechAssetUrls: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("@/lib/demo/types", () => ({
  normalizeDemoExperience: mocks.normalizeDemoExperience,
}));

vi.mock("@/lib/demo/server", () => ({
  authorizeDemoWorkspaceToken: mocks.authorizeDemoWorkspaceToken,
  bootstrapDemoWorkspace: mocks.bootstrapDemoWorkspace,
  createDemoSessionToken: mocks.createDemoSessionToken,
  getAuthSessionCookieName: mocks.getAuthSessionCookieName,
  getAuthSessionCookieOptions: mocks.getAuthSessionCookieOptions,
  getDemoCookieOptions: mocks.getDemoCookieOptions,
  getDemoWorkspaceCookieName: mocks.getDemoWorkspaceCookieName,
  resetDemoWorkspace: mocks.resetDemoWorkspace,
  cleanupExpiredDemoWorkspaces: mocks.cleanupExpiredDemoWorkspaces,
}));

vi.mock("@/lib/sequencing-tech/config", () => ({
  getDefaultTechSyncUrl: mocks.getDefaultTechSyncUrl,
  parseTechConfig: mocks.parseTechConfig,
  withResolvedTechAssetUrls: mocks.withResolvedTechAssetUrls,
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { GET as getSequencingTech } from "./sequencing-tech/route";
import { POST as postDemoBootstrap } from "./demo/bootstrap/route";
import { POST as postDemoReset } from "./demo/reset/route";
import { GET as getDemoCleanup } from "./demo/cleanup/route";

describe("public and demo route quick wins", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.cookies.mockResolvedValue(cookieStore);
    cookieStore.get.mockReturnValue(undefined);
    mocks.normalizeDemoExperience.mockReturnValue("full");
    mocks.authorizeDemoWorkspaceToken.mockResolvedValue({
      id: "demo-user-1",
    });
    mocks.bootstrapDemoWorkspace.mockResolvedValue({
      created: true,
      expiresAt: new Date("2026-03-26T10:00:00.000Z"),
      workspaceId: "workspace-1",
      token: "workspace-token",
    });
    mocks.resetDemoWorkspace.mockResolvedValue({
      created: false,
      expiresAt: new Date("2026-03-26T10:00:00.000Z"),
      workspaceId: "workspace-1",
      token: "workspace-token",
    });
    mocks.createDemoSessionToken.mockResolvedValue("session-token");
    mocks.getAuthSessionCookieName.mockReturnValue("auth-cookie");
    mocks.getAuthSessionCookieOptions.mockReturnValue({ httpOnly: true });
    mocks.getDemoCookieOptions.mockReturnValue({ sameSite: "lax" });
    mocks.getDemoWorkspaceCookieName.mockReturnValue("demo-workspace");
    mocks.cleanupExpiredDemoWorkspaces.mockResolvedValue({
      removed: 2,
    });
    mocks.getDefaultTechSyncUrl.mockReturnValue("https://api.seqdesk.test/tech");
    mocks.parseTechConfig.mockReturnValue({
      syncUrl: "",
      technologies: [
        { id: "ont", order: 2, available: true, comingSoon: false },
        { id: "pb", order: 1, available: false, comingSoon: false },
      ],
      devices: [
        { id: "dev-2", order: 2, available: true, comingSoon: false },
        { id: "dev-1", order: 1, available: true, comingSoon: false },
      ],
      flowCells: [
        { id: "flow-2", order: 2, available: true },
        { id: "flow-1", order: 1, available: true },
      ],
      kits: [
        { id: "kit-2", order: 2, available: true },
        { id: "kit-1", order: 1, available: true },
      ],
      software: [
        { id: "soft-2", order: 2, available: true },
        { id: "soft-1", order: 1, available: true },
      ],
      barcodeSchemes: [{ id: "scheme-1" }],
      barcodeSets: [{ id: "set-1" }],
    });
    mocks.withResolvedTechAssetUrls.mockImplementation((config) => config);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        sequencingTechConfig: {
          syncUrl: "https://custom.example/tech",
        },
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("filters and sorts sequencing technologies and handles invalid stored JSON", async () => {
    const success = await getSequencingTech();
    expect(success.status).toBe(200);
    expect(mocks.parseTechConfig).toHaveBeenCalledWith({
      syncUrl: "https://custom.example/tech",
    });
    expect(await success.json()).toEqual({
      technologies: [{ id: "ont", order: 2, available: true, comingSoon: false }],
      devices: [
        { id: "dev-1", order: 1, available: true, comingSoon: false },
        { id: "dev-2", order: 2, available: true, comingSoon: false },
      ],
      flowCells: [
        { id: "flow-1", order: 1, available: true },
        { id: "flow-2", order: 2, available: true },
      ],
      kits: [
        { id: "kit-1", order: 1, available: true },
        { id: "kit-2", order: 2, available: true },
      ],
      software: [
        { id: "soft-1", order: 1, available: true },
        { id: "soft-2", order: 2, available: true },
      ],
      barcodeSchemes: [{ id: "scheme-1" }],
      barcodeSets: [{ id: "set-1" }],
    });
    expect(success.headers.get("Cache-Control")).toBe("no-store");

    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      extraSettings: "{bad-json",
    });
    await getSequencingTech();
    expect(mocks.parseTechConfig).toHaveBeenLastCalledWith(null);

    mocks.db.siteSettings.findUnique.mockRejectedValueOnce(new Error("db down"));
    const failed = await getSequencingTech();
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to fetch technologies",
    });
  });

  it("bootstraps demo workspaces using explicit or cookie tokens", async () => {
    const explicit = await postDemoBootstrap(
      new Request("http://localhost/api/demo/bootstrap", {
        method: "POST",
        body: JSON.stringify({
          workspace: " explicit-token ",
          demoExperience: "lite",
        }),
      })
    );

    expect(explicit.status).toBe(200);
    expect(mocks.normalizeDemoExperience).toHaveBeenCalledWith("lite");
    expect(mocks.bootstrapDemoWorkspace).toHaveBeenCalledWith("explicit-token", "full");
    expect(mocks.authorizeDemoWorkspaceToken).toHaveBeenCalledWith(
      "workspace-token",
      "full"
    );
    expect(explicit.cookies.get("demo-workspace")?.value).toBe("workspace-token");
    expect(explicit.cookies.get("auth-cookie")?.value).toBe("session-token");
    expect(explicit.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(await explicit.json()).toEqual({
      created: true,
      expiresAt: "2026-03-26T10:00:00.000Z",
      workspaceId: "workspace-1",
      demoExperience: "full",
    });

    cookieStore.get.mockReturnValueOnce({ value: "cookie-token" });
    await postDemoBootstrap(
      new Request("http://localhost/api/demo/bootstrap", {
        method: "POST",
        body: JSON.stringify({}),
      })
    );
    expect(mocks.bootstrapDemoWorkspace).toHaveBeenLastCalledWith("cookie-token", "full");
  });

  it("maps demo bootstrap failures", async () => {
    mocks.authorizeDemoWorkspaceToken.mockResolvedValueOnce(null);
    const failedSession = await postDemoBootstrap(
      new Request("http://localhost/api/demo/bootstrap", {
        method: "POST",
        body: JSON.stringify({}),
      })
    );
    expect(failedSession.status).toBe(500);
    expect(await failedSession.json()).toEqual({
      error: "Failed to create demo session",
    });

    mocks.bootstrapDemoWorkspace.mockRejectedValueOnce(new Error("bootstrap failed"));
    const failed = await postDemoBootstrap(
      new Request("http://localhost/api/demo/bootstrap", {
        method: "POST",
        body: JSON.stringify({}),
      })
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "bootstrap failed",
    });
  });

  it("resets demo workspaces and maps reset failures", async () => {
    cookieStore.get.mockReturnValueOnce({ value: "cookie-token" });
    const success = await postDemoReset(
      new Request("http://localhost/api/demo/reset", {
        method: "POST",
        body: JSON.stringify({ demoExperience: "embed" }),
      })
    );

    expect(success.status).toBe(200);
    expect(mocks.resetDemoWorkspace).toHaveBeenCalledWith("cookie-token", "full");
    expect(success.cookies.get("demo-workspace")?.value).toBe("workspace-token");
    expect(await success.json()).toEqual({
      created: false,
      expiresAt: "2026-03-26T10:00:00.000Z",
      workspaceId: "workspace-1",
      demoExperience: "full",
    });

    mocks.authorizeDemoWorkspaceToken.mockResolvedValueOnce(null);
    const failedSession = await postDemoReset(
      new Request("http://localhost/api/demo/reset", {
        method: "POST",
        body: JSON.stringify({}),
      })
    );
    expect(failedSession.status).toBe(500);
    expect(await failedSession.json()).toEqual({
      error: "Failed to create demo session",
    });

    mocks.resetDemoWorkspace.mockRejectedValueOnce(new Error("reset failed"));
    const failed = await postDemoReset(
      new Request("http://localhost/api/demo/reset", {
        method: "POST",
        body: JSON.stringify({}),
      })
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "reset failed",
    });
  });

  it("authorizes cleanup by environment secret or non-production fallback", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("DEMO_CLEANUP_SECRET", "");

    const devSuccess = await getDemoCleanup(
      new Request("http://localhost/api/demo/cleanup") as never
    );
    expect(devSuccess.status).toBe(200);
    expect(devSuccess.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(await devSuccess.json()).toEqual({ removed: 2 });

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "cron-secret");

    const unauthorized = await getDemoCleanup(
      new Request("http://localhost/api/demo/cleanup") as never
    );
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    const authorized = await getDemoCleanup(
      new Request("http://localhost/api/demo/cleanup", {
        headers: { authorization: "Bearer cron-secret" },
      }) as never
    );
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toEqual({ removed: 2 });

    mocks.cleanupExpiredDemoWorkspaces.mockRejectedValueOnce(new Error("cleanup failed"));
    const failed = await getDemoCleanup(
      new Request("http://localhost/api/demo/cleanup", {
        headers: { authorization: "Bearer cron-secret" },
      }) as never
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "cleanup failed",
    });
  });
});
