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

describe("GET /api/admin/modules/account-validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
  });

  it("returns default account validation settings when none are stored", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.settings.allowedDomains).toEqual([]);
    expect(body.settings.enforceValidation).toBe(true);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(401);
  });
});

describe("PUT /api/admin/modules/account-validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    mocks.db.siteSettings.upsert.mockResolvedValue({});
  });

  it("saves valid account validation settings", async () => {
    const settings = {
      allowedDomains: ["example.com", "university.edu"],
      enforceValidation: true,
    };

    const request = new NextRequest(
      "http://localhost/api/admin/modules/account-validation",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings }),
      }
    );

    const response = await PUT(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.settings.allowedDomains).toEqual(["example.com", "university.edu"]);
    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);
  });

  it("returns 401 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const request = new NextRequest(
      "http://localhost/api/admin/modules/account-validation",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: {} }),
      }
    );

    const response = await PUT(request);
    expect(response.status).toBe(401);
  });

  it("returns 400 when settings are missing", async () => {
    const request = new NextRequest(
      "http://localhost/api/admin/modules/account-validation",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }
    );

    const response = await PUT(request);
    expect(response.status).toBe(400);
  });
});
