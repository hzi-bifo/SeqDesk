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

import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";
import { GET, PUT } from "./route";

const adminSession = {
  user: { id: "admin-1", systemRole: "ADMIN", role: "RESEARCHER" },
};
const memberSession = {
  user: { id: "member-1", systemRole: "MEMBER", role: "RESEARCHER" },
};

describe("GET /api/admin/modules/billing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("sequencing-center")
    );
    mocks.getServerSession.mockResolvedValue(adminSession);
  });

  it("returns default billing settings when none are stored", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.settings.pspEnabled).toBe(true);
    expect(body.settings.costCenterEnabled).toBe(true);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.db.siteSettings.findUnique).not.toHaveBeenCalled();
  });

  it("allows a member to read the non-secret format used by order forms", async () => {
    mocks.getServerSession.mockResolvedValue(memberSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(200);
  });

  it("returns 404 when the order domain is genuinely absent", async () => {
    const profile = getDeploymentProfileDefinition("research-workbench");
    mocks.getServerDeploymentProfile.mockReturnValue({ ...profile, domains: profile.domains.filter(domain => domain !== "facility-intake") });

    const response = await GET();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(mocks.db.siteSettings.findUnique).not.toHaveBeenCalled();
  });

  it("allows research-preset members to read shared non-secret field formats", async () => {
    mocks.getServerDeploymentProfile.mockReturnValue(getDeploymentProfileDefinition("research-workbench"));
    mocks.getServerSession.mockResolvedValue(memberSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).settings.costCenterEnabled).toBe(true);
    expect(mocks.db.siteSettings.upsert).not.toHaveBeenCalled();
  });
});

describe("PUT /api/admin/modules/billing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("sequencing-center")
    );
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    mocks.db.siteSettings.upsert.mockResolvedValue({});
  });

  it("saves valid billing settings", async () => {
    const settings = {
      pspEnabled: true,
      pspPrefixRange: { min: 1, max: 9 },
      pspMainDigits: 7,
      pspSuffixRange: { min: 1, max: 99 },
      pspExample: "1-1234567-99",
      costCenterEnabled: false,
      costCenterExample: "",
    };

    const request = new NextRequest("http://localhost/api/admin/modules/billing", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings }),
    });

    const response = await PUT(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.settings).toEqual(settings);
    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);
  });

  it("returns 403 for users without settings access", async () => {
    mocks.getServerSession.mockResolvedValue(memberSession);

    const request = new NextRequest("http://localhost/api/admin/modules/billing", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: {} }),
    });

    const response = await PUT(request);
    expect(response.status).toBe(403);
  });

  it("returns 404 before mutation when the order domain is genuinely absent", async () => {
    const profile = getDeploymentProfileDefinition("research-workbench");
    mocks.getServerDeploymentProfile.mockReturnValue({ ...profile, domains: profile.domains.filter(domain => domain !== "facility-intake") });

    const request = new NextRequest("http://localhost/api/admin/modules/billing", {
      method: "PUT",
      body: JSON.stringify({ settings: {} }),
    });
    const response = await PUT(request);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(mocks.db.siteSettings.upsert).not.toHaveBeenCalled();
  });

  it("lets a research-preset admin configure billing without enabling the module", async () => {
    mocks.getServerDeploymentProfile.mockReturnValue(getDeploymentProfileDefinition("research-workbench"));
    mocks.db.siteSettings.findUnique.mockResolvedValue({ modulesConfig: JSON.stringify({ modules: { "billing-info": false }, globalDisabled: true }) });
    const settings = { pspEnabled: false, costCenterEnabled: false };
    const response = await PUT(new NextRequest("http://localhost/api/admin/modules/billing", {
      method: "PUT", body: JSON.stringify({ settings }),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).settings).toEqual(settings);
    expect(mocks.db.siteSettings.upsert.mock.calls[0][0].update).not.toHaveProperty("modulesConfig");
  });

  it("returns 400 when settings are missing", async () => {
    const request = new NextRequest("http://localhost/api/admin/modules/billing", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await PUT(request);
    expect(response.status).toBe(400);
  });
});
