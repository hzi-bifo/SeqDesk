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

vi.mock("@/lib/modules/types", () => ({
  DEFAULT_MODULE_STATES: {
    "ai-validation": true,
    "mixs-metadata": true,
    "account-validation": false,
  },
}));

import { GET, PUT } from "./route";

const adminSession = { user: { id: "admin-1", role: "FACILITY_ADMIN" } };
const userSession = { user: { id: "user-1", role: "RESEARCHER" } };

describe("GET /api/admin/modules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns default module config when no settings stored", async () => {
    mocks.getServerSession.mockResolvedValue(userSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.modules).toEqual({
      "ai-validation": true,
      "mixs-metadata": true,
      "account-validation": false,
    });
    expect(data.globalDisabled).toBe(false);
  });

  it("returns stored module config for authenticated user", async () => {
    mocks.getServerSession.mockResolvedValue(userSession);
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
});

describe("PUT /api/admin/modules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.siteSettings.upsert.mockResolvedValue({});
  });

  it("returns 401 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue(userSession);
    const req = new NextRequest("http://localhost/api/admin/modules", {
      method: "PUT",
      body: JSON.stringify({ moduleId: "ai-validation", enabled: false }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(401);
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
});
