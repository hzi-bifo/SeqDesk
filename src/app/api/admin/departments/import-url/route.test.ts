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

import { GET, POST } from "./route";

const adminSession = { user: { id: "admin-1", role: "FACILITY_ADMIN" } };
const userSession = { user: { id: "user-1", role: "RESEARCHER" } };

describe("GET /api/admin/departments/import-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when user is not admin", async () => {
    mocks.getServerSession.mockResolvedValue(userSession);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns null url when no settings exist", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: null, lastImportedAt: null });
  });

  it("returns null url when extraSettings is null", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: null,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: null, lastImportedAt: null });
  });

  it("returns url from extraSettings", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        departmentImportUrl: "https://example.com/departments.csv",
        departmentImportLastUsed: "2024-01-15T10:00:00.000Z",
      }),
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.url).toBe("https://example.com/departments.csv");
    expect(data.lastImportedAt).toBe("2024-01-15T10:00:00.000Z");
  });

  it("returns null on parse error", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: "not-json{{{",
    });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: null, lastImportedAt: null });
  });
});

describe("POST /api/admin/departments/import-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const req = new NextRequest(
      "http://localhost/api/admin/departments/import-url",
      {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/data.csv" }),
      }
    );

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when user is not admin", async () => {
    mocks.getServerSession.mockResolvedValue(userSession);
    const req = new NextRequest(
      "http://localhost/api/admin/departments/import-url",
      {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/data.csv" }),
      }
    );

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("saves URL and returns success when settings exist", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      id: "singleton",
      extraSettings: JSON.stringify({ someOtherSetting: true }),
    });
    mocks.db.siteSettings.upsert.mockResolvedValue({});

    const req = new NextRequest(
      "http://localhost/api/admin/departments/import-url",
      {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/data.csv" }),
      }
    );

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    const upsertCall = mocks.db.siteSettings.upsert.mock.calls[0][0];
    expect(upsertCall.where).toEqual({ id: "singleton" });
    const savedExtra = JSON.parse(upsertCall.update.extraSettings);
    expect(savedExtra.departmentImportUrl).toBe(
      "https://example.com/data.csv"
    );
    expect(savedExtra.someOtherSetting).toBe(true);
    expect(savedExtra.departmentImportLastUsed).toBeDefined();
  });

  it("creates settings via upsert when none exist", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    mocks.db.siteSettings.upsert.mockResolvedValue({});

    const req = new NextRequest(
      "http://localhost/api/admin/departments/import-url",
      {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/new.csv" }),
      }
    );

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    const upsertCall = mocks.db.siteSettings.upsert.mock.calls[0][0];
    expect(upsertCall.where).toEqual({ id: "singleton" });
    const createdExtra = JSON.parse(upsertCall.create.extraSettings);
    expect(createdExtra.departmentImportUrl).toBe(
      "https://example.com/new.csv"
    );
  });

  it("returns 500 on database error", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockRejectedValue(new Error("DB error"));

    const req = new NextRequest(
      "http://localhost/api/admin/departments/import-url",
      {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/data.csv" }),
      }
    );

    const res = await POST(req);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to save URL" });
  });
});
