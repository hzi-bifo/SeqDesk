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
import { isModuleEnabled } from "@/lib/modules/form-integration";

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

  it("returns shared modules in the research preset with facility management initially disabled", async () => {
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
      "ai-validation": true,
      "mixs-metadata": true,
      "ena-sample-fields": true,
      "sequencing-tech": true,
      "sequencing-management": false,
      "import-cami": true,
      "import-sra": true,
      notifications: true,
    });
    expect(data.incompatibleModules).toEqual([]);
  });

  it.each(["sequencing-center", "shared-lab", "research-workbench"] as const)("retains individual choices and honors a global pause in %s", async profile => {
    mocks.getServerDeploymentProfile.mockReturnValue(getDeploymentProfileDefinition(profile));
    mocks.db.siteSettings.findUnique.mockResolvedValue({ modulesConfig: JSON.stringify({ modules: { "sequencing-management": true, "import-cami": false, "import-sra": true }, globalDisabled: false }) });
    const individual = await (await GET()).json();
    expect(isModuleEnabled(individual, "sequencing-management")).toBe(true);
    expect(isModuleEnabled(individual, "import-cami")).toBe(false);
    expect(isModuleEnabled(individual, "import-sra")).toBe(true);

    mocks.db.siteSettings.findUnique.mockResolvedValue({ modulesConfig: JSON.stringify({ modules: individual.modules, globalDisabled: true }) });
    const paused = await (await GET()).json();
    expect(paused.modules).toEqual(individual.modules);
    expect(paused.globalDisabled).toBe(true);
    expect(isModuleEnabled(paused, "sequencing-management")).toBe(false);
    expect(isModuleEnabled(paused, "import-cami")).toBe(false);
    expect(isModuleEnabled(paused, "import-sra")).toBe(false);
    expect(isModuleEnabled(paused, "explore")).toBe(false);
    expect(isModuleEnabled(paused, "sequencing-tech")).toBe(true);
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
