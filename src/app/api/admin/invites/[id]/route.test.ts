import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    adminInvite: {
      findUnique: vi.fn(),
      delete: vi.fn(),
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

import { DELETE } from "./route";

const adminSession = { user: { id: "admin-1", role: "FACILITY_ADMIN" } };
const userSession = { user: { id: "user-1", role: "RESEARCHER" } };

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/admin/invites/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/admin/invites/inv-1", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("inv-1"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when user is not admin", async () => {
    mocks.getServerSession.mockResolvedValue(userSession);
    const req = new NextRequest("http://localhost/api/admin/invites/inv-1", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("inv-1"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 404 when invite not found", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.adminInvite.findUnique.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/admin/invites/inv-1", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("inv-1"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Invite not found" });
  });

  it("returns 400 when invite already used", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.adminInvite.findUnique.mockResolvedValue({
      id: "inv-1",
      usedAt: new Date("2024-01-01"),
    });
    const req = new NextRequest("http://localhost/api/admin/invites/inv-1", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("inv-1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Cannot revoke a used invite" });
  });

  it("returns 200 on successful deletion", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.adminInvite.findUnique.mockResolvedValue({
      id: "inv-1",
      usedAt: null,
    });
    mocks.db.adminInvite.delete.mockResolvedValue({});
    const req = new NextRequest("http://localhost/api/admin/invites/inv-1", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("inv-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mocks.db.adminInvite.delete).toHaveBeenCalledWith({
      where: { id: "inv-1" },
    });
  });

  it("returns 500 on database error", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.adminInvite.findUnique.mockRejectedValue(new Error("DB error"));
    const req = new NextRequest("http://localhost/api/admin/invites/inv-1", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("inv-1"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to delete invite" });
  });
});
