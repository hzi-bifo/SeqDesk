import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  checkDatabaseStatus: vi.fn(),
  readInstallProfileFromConfig: vi.fn(),
  defaultProfileRegistryUrl: vi.fn(),
  reloadHostedInstallProfile: vi.fn(),
  resolveProfileCodeFromEnv: vi.fn(),
  updateAdminActivityJob: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/admin/activity", () => ({
  updateAdminActivityJob: mocks.updateAdminActivityJob,
}));

vi.mock("@/lib/db-status", () => ({
  checkDatabaseStatus: mocks.checkDatabaseStatus,
}));

vi.mock("@/lib/setup-status", () => ({
  readInstallProfileFromConfig: mocks.readInstallProfileFromConfig,
}));

vi.mock("@/lib/install-profile/reload", () => ({
  defaultProfileRegistryUrl: mocks.defaultProfileRegistryUrl,
  profileCodeEnvName: (profileId: string) =>
    `${profileId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_SETUP_CODE`,
  reloadHostedInstallProfile: mocks.reloadHostedInstallProfile,
  resolveProfileCodeFromEnv: mocks.resolveProfileCodeFromEnv,
}));

import { GET, POST } from "./route";

function jsonRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/install-profile/reload", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("/api/admin/install-profile/reload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.checkDatabaseStatus.mockResolvedValue({
      installProfile: {
        id: "dev",
        name: "Development",
        version: "2026.05.13",
        appliedAt: "2026-05-13T10:00:00.000Z",
        source: "database",
      },
    });
    mocks.readInstallProfileFromConfig.mockReturnValue(null);
    mocks.defaultProfileRegistryUrl.mockReturnValue(
      "https://www.seqdesk.com/api/install-profiles"
    );
    mocks.resolveProfileCodeFromEnv.mockReturnValue(undefined);
    mocks.reloadHostedInstallProfile.mockResolvedValue({
      profile: { id: "dev", version: "2026.05.13" },
      includeAssets: false,
      validation: { warnings: [], ignoredSections: [], appliedSections: [] },
      settings: {
        script: "scripts/apply-install-profile.mjs",
        stdout: "applied",
        stderr: "",
      },
    });
  });

  it("returns recorded profile status for facility admins", async () => {
    mocks.resolveProfileCodeFromEnv.mockReturnValue("env-code");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      profile: expect.objectContaining({
        id: "dev",
        version: "2026.05.13",
      }),
      profileRegistryUrl: "https://www.seqdesk.com/api/install-profiles",
      profileCodeEnvName: "DEV_SETUP_CODE",
      profileCodeEnvAvailable: true,
    });
  });

  it("falls back to seqdesk.config.json profile metadata", async () => {
    mocks.checkDatabaseStatus.mockResolvedValue({});
    mocks.readInstallProfileFromConfig.mockReturnValue({
      id: "local-dev",
      version: "2026.05.14",
      source: "config",
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.profile).toMatchObject({
      id: "local-dev",
      version: "2026.05.14",
      source: "config",
    });
    expect(body.profileCodeEnvName).toBe("LOCAL_DEV_SETUP_CODE");
  });

  it("rejects non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("reloads the applied profile with the submitted setup code", async () => {
    const response = await POST(
      jsonRequest({
        profileCode: "setup-code",
        includeAssets: true,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mocks.reloadHostedInstallProfile).toHaveBeenCalledWith({
      profileId: "dev",
      profileCode: "setup-code",
      includeAssets: true,
    });
    expect(mocks.updateAdminActivityJob).toHaveBeenCalledWith(
      "install-profile-reload:dev",
      expect.objectContaining({
        type: "install-profile-reload",
        state: "success",
      })
    );
  });

  it("rejects browser-supplied registry URL overrides", async () => {
    const response = await POST(
      jsonRequest({
        profileId: "qa",
        profileCode: "setup-code",
        profileRegistryUrl: "https://profiles.example.test/api",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("registry override is not accepted");
    expect(mocks.reloadHostedInstallProfile).not.toHaveBeenCalled();
  });

  it("returns 400 when no profile id is known", async () => {
    mocks.checkDatabaseStatus.mockResolvedValue({});
    mocks.readInstallProfileFromConfig.mockReturnValue(null);

    const response = await POST(jsonRequest({ profileCode: "setup-code" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("No hosted install profile is recorded for this installation");
    expect(mocks.reloadHostedInstallProfile).not.toHaveBeenCalled();
  });

  it("returns a user error when no setup code is available", async () => {
    mocks.reloadHostedInstallProfile.mockRejectedValue(
      new Error("Profile access code is required")
    );

    const response = await POST(jsonRequest({ profileCode: "" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Profile access code is required");
  });

  it("rejects a concurrent reload without clobbering the running job status", async () => {
    mocks.reloadHostedInstallProfile.mockRejectedValue(
      new Error("A hosted profile reload is already running")
    );

    const response = await POST(jsonRequest({ profileCode: "setup-code" }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("A hosted profile reload is already running");
    // The running reload owns this profile's activity job; the losing request
    // must not write an "error" state over it.
    expect(mocks.updateAdminActivityJob).not.toHaveBeenCalledWith(
      "install-profile-reload:dev",
      expect.objectContaining({ state: "error" })
    );
  });

  it("surfaces unexpected reload errors", async () => {
    mocks.reloadHostedInstallProfile.mockRejectedValue(
      new Error("apply-install-profile exited with code 1")
    );

    const response = await POST(jsonRequest({ profileCode: "setup-code" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("apply-install-profile exited with code 1");
  });
});
