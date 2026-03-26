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

import { GET, PUT } from "./route";

const adminSession = { user: { id: "admin-1", role: "FACILITY_ADMIN" } };
const userSession = { user: { id: "user-1", role: "RESEARCHER" } };

describe("GET /api/admin/settings/ena", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue(userSession);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns ENA settings with masked password for admin", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "Webin-12345",
      enaPassword: "secret",
      enaTestMode: false,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      enaUsername: "Webin-12345",
      hasPassword: true,
      enaTestMode: false,
      configured: true,
    });
  });

  it("returns defaults when no settings exist", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);

    const res = await GET();
    const data = await res.json();
    expect(data).toEqual({
      enaUsername: "",
      hasPassword: false,
      enaTestMode: true,
      configured: false,
    });
  });
});

describe("PUT /api/admin/settings/ena", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.siteSettings.upsert.mockResolvedValue({});
  });

  it("returns 401 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue(userSession);
    const req = new NextRequest("http://localhost/api/admin/settings/ena", {
      method: "PUT",
      body: JSON.stringify({ enaUsername: "Webin-99999" }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(401);
  });

  it("validates ENA username format", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const req = new NextRequest("http://localhost/api/admin/settings/ena", {
      method: "PUT",
      body: JSON.stringify({ enaUsername: "bad-format" }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Webin-XXXXX");
  });

  it("saves valid ENA settings", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const req = new NextRequest("http://localhost/api/admin/settings/ena", {
      method: "PUT",
      body: JSON.stringify({
        enaUsername: "Webin-12345",
        enaPassword: "newpass",
        enaTestMode: true,
      }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "singleton" },
        update: {
          enaUsername: "Webin-12345",
          enaPassword: "newpass",
          enaTestMode: true,
        },
      })
    );
  });
});
