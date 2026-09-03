import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getServerDeploymentProfile: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
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

vi.mock("@/lib/deployment-profile/server", () => ({
  getServerDeploymentProfile: mocks.getServerDeploymentProfile,
}));

import { GET } from "./route";
import { getDeploymentProfileDefinition } from "@/lib/deployment-profile/definitions";
import { DEFAULT_MODULE_STATES } from "@/lib/modules/types";

describe("GET /api/modules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("sequencing-center")
    );
  });

  it("returns 401 when no session", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.db.siteSettings.findUnique).not.toHaveBeenCalled();
  });

  it("returns the config for an authenticated researcher", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: JSON.stringify({
        modules: {
          "funding-info": true,
        },
        globalDisabled: false,
      }),
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      modules: {
        ...DEFAULT_MODULE_STATES,
        "funding-info": true,
      },
      globalDisabled: false,
      incompatibleModules: [],
    });
  });

  it("returns defaults when module config is missing", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: null,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      modules: DEFAULT_MODULE_STATES,
      globalDisabled: false,
      incompatibleModules: [],
    });
  });

  it("merges modern nested config with defaults", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: JSON.stringify({
        modules: {
          "funding-info": true,
        },
        globalDisabled: true,
      }),
    });

    const response = await GET();

    await expect(response.json()).resolves.toEqual({
      modules: {
        ...DEFAULT_MODULE_STATES,
        "funding-info": true,
      },
      globalDisabled: true,
      incompatibleModules: [],
    });
  });

  it("supports legacy flat config payloads", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: JSON.stringify({
        "account-validation": true,
      }),
    });

    const response = await GET();

    await expect(response.json()).resolves.toEqual({
      modules: {
        ...DEFAULT_MODULE_STATES,
        "account-validation": true,
      },
      globalDisabled: false,
      incompatibleModules: [],
    });
  });

  it("falls back to defaults when stored config is invalid", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: "{bad-json",
    });

    const response = await GET();

    await expect(response.json()).resolves.toEqual({
      modules: DEFAULT_MODULE_STATES,
      globalDisabled: false,
      incompatibleModules: [],
    });
  });

  it("returns profile-constrained defaults in Research Workbench", async () => {
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("research-workbench")
    );
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: JSON.stringify({
        modules: { "ai-validation": true, notifications: true },
        globalDisabled: false,
      }),
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.modules).toMatchObject({
      "ai-validation": false,
      "mixs-metadata": false,
      "ena-sample-fields": false,
      "sequencing-tech": false,
      notifications: true,
    });
    expect(data.incompatibleModules).toEqual(
      expect.arrayContaining([
        "ai-validation",
        "mixs-metadata",
        "ena-sample-fields",
        "sequencing-tech",
      ])
    );
  });

  it("returns 500 when the database read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.db.siteSettings.findUnique.mockRejectedValue(new Error("db down"));

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to fetch module configuration",
    });
  });
});
