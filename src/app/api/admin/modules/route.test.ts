import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getServerDeploymentProfile: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
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

import { GET, PUT } from "./route";
import { getDeploymentProfileDefinition } from "@/lib/deployment-profile/definitions";
import { DEFAULT_MODULE_STATES } from "@/lib/modules/types";

const adminSession = {
  user: { id: "admin-1", systemRole: "ADMIN", role: "RESEARCHER" },
};
const userSession = {
  user: { id: "user-1", systemRole: "MEMBER", role: "FACILITY_ADMIN" },
};

describe("GET /api/admin/modules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("sequencing-center")
    );
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mocks.db.siteSettings.findUnique).not.toHaveBeenCalled();
  });

  it("returns 403 when a member requests administrative module settings", async () => {
    mocks.getServerSession.mockResolvedValue(userSession);

    const res = await GET();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(mocks.db.siteSettings.findUnique).not.toHaveBeenCalled();
  });

  it("returns default module config when no settings stored", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.modules).toEqual(DEFAULT_MODULE_STATES);
    expect(data.globalDisabled).toBe(false);
    expect(data.incompatibleModules).toEqual([]);
  });

  it("returns stored module config for an administrator", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: JSON.stringify({
        modules: { "ai-validation": false, "mixs-metadata": true, "account-validation": true },
        globalDisabled: true,
      }),
    });

    const res = await GET();
    const data = await res.json();
    expect(data.modules["ai-validation"]).toBe(false);
    expect(data.modules["account-validation"]).toBe(true);
    expect(data.globalDisabled).toBe(true);
  });

  it("keeps shared metadata modules available in the research preset", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("research-workbench")
    );
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: JSON.stringify({
        modules: { "billing-info": true, notifications: true },
        globalDisabled: false,
      }),
    });

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.modules["billing-info"]).toBe(true);
    expect(data.modules["sequencing-tech"]).toBe(true);
    expect(data.modules["sequencing-management"]).toBe(false);
    expect(data.modules["import-cami"]).toBe(true);
    expect(data.modules["import-sra"]).toBe(true);
    expect(data.modules.notifications).toBe(true);
    expect(data.incompatibleModules).toEqual([]);
  });
});

describe("PUT /api/admin/modules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("sequencing-center")
    );
    mocks.db.siteSettings.upsert.mockResolvedValue({});
  });

  it("returns 403 for users without settings access", async () => {
    mocks.getServerSession.mockResolvedValue(userSession);
    const req = new NextRequest("http://localhost/api/admin/modules", {
      method: "PUT",
      body: JSON.stringify({ moduleId: "ai-validation", enabled: false }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(403);
  });

  it("updates individual module state", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/admin/modules", {
      method: "PUT",
      body: JSON.stringify({ moduleId: "ai-validation", enabled: false }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.modules["ai-validation"]).toBe(false);

    const upsertCall = mocks.db.siteSettings.upsert.mock.calls[0][0];
    const savedConfig = JSON.parse(upsertCall.update.modulesConfig);
    expect(savedConfig.modules["ai-validation"]).toBe(false);
  });

  it("updates globalDisabled flag", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/admin/modules", {
      method: "PUT",
      body: JSON.stringify({ globalDisabled: true }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.globalDisabled).toBe(true);
  });

  it("rejects a feature module that requires a domain outside the deployment profile", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const profile = getDeploymentProfileDefinition("research-workbench");
    // Exercise domain enforcement without relying on a removed preset split.
    mocks.getServerDeploymentProfile.mockReturnValue({ ...profile, domains: profile.domains.filter(domain => domain !== "facility-intake") });

    const req = new NextRequest("http://localhost/api/admin/modules", {
      method: "PUT",
      body: JSON.stringify({ moduleId: "billing-info", enabled: true }),
    });
    const res = await PUT(req);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      code: "PROFILE_MODULE_INCOMPATIBLE",
      error: expect.stringContaining("cannot enable modules.billing-info"),
    });
    expect(mocks.db.siteSettings.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.siteSettings.upsert).not.toHaveBeenCalled();
  });

  it("allows a research-preset administrator to enable facility management alongside imports", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.getServerDeploymentProfile.mockReturnValue(getDeploymentProfileDefinition("research-workbench"));
    mocks.db.siteSettings.findUnique.mockResolvedValue({ modulesConfig: JSON.stringify({ modules: { "import-cami": true, "import-sra": false }, globalDisabled: true }) });
    const response = await PUT(new NextRequest("http://localhost/api/admin/modules", {
      method: "PUT", body: JSON.stringify({ moduleId: "sequencing-management", enabled: true }),
    }));
    expect(response.status).toBe(200);
    const saved = JSON.parse(mocks.db.siteSettings.upsert.mock.calls[0][0].update.modulesConfig);
    expect(saved.modules).toMatchObject({ "sequencing-management": true, "import-cami": true, "import-sra": false });
    expect(saved.globalDisabled).toBe(true);
  });

  it("rejects unknown feature-module switches before writing settings", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);

    const req = new NextRequest("http://localhost/api/admin/modules", {
      method: "PUT",
      body: JSON.stringify({ moduleId: "made-up-module", enabled: true }),
    });
    const res = await PUT(req);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      code: "PROFILE_MODULE_INCOMPATIBLE",
      error: expect.stringContaining("not a recognized SeqDesk feature module"),
    });
    expect(mocks.db.siteSettings.upsert).not.toHaveBeenCalled();
  });
});
