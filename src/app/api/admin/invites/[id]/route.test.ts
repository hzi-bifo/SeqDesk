import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    user: { findUnique: vi.fn() },
    adminInvite: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));

import { DELETE } from "./route";

const adminSession = {
  user: { id: "admin-1", role: "FACILITY_ADMIN", systemRole: "ADMIN" },
};

function request() {
  return new NextRequest("http://localhost/api/admin/invites/invite-1", {
    method: "DELETE",
  });
}

function params(id = "invite-1") {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/admin/invites/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.user.findUnique.mockResolvedValue({
      systemRole: "ADMIN",
      isActive: true,
    });
    mocks.db.adminInvite.updateMany.mockResolvedValue({ count: 1 });
  });

  it("requires administrator access", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    expect((await DELETE(request(), params())).status).toBe(401);

    mocks.getServerSession.mockResolvedValue({
      user: { id: "member-1", role: "RESEARCHER", systemRole: "MEMBER" },
    });
    expect((await DELETE(request(), params())).status).toBe(403);
  });

  it("rejects a stale session after the actor is demoted or deactivated", async () => {
    mocks.db.user.findUnique.mockResolvedValue({
      systemRole: "MEMBER",
      isActive: true,
    });

    const response = await DELETE(request(), params());

    expect(response.status).toBe(403);
    expect(mocks.db.adminInvite.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when the invitation does not exist", async () => {
    mocks.db.adminInvite.findUnique.mockResolvedValue(null);

    const response = await DELETE(request(), params());

    expect(response.status).toBe(404);
  });

  it("retains used invitations as immutable audit history", async () => {
    mocks.db.adminInvite.findUnique.mockResolvedValue({
      id: "invite-1",
      usedAt: new Date(),
      revokedAt: null,
    });

    const response = await DELETE(request(), params());

    expect(response.status).toBe(400);
    expect(mocks.db.adminInvite.updateMany).not.toHaveBeenCalled();
  });

  it("atomically soft-revokes a pending invitation", async () => {
    mocks.db.adminInvite.findUnique.mockResolvedValue({
      id: "invite-1",
      usedAt: null,
      revokedAt: null,
    });

    const response = await DELETE(request(), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true });
    expect(body.revokedAt).toEqual(expect.any(String));
    expect(mocks.db.adminInvite.updateMany).toHaveBeenCalledWith({
      where: { id: "invite-1", usedAt: null, revokedAt: null },
      data: { revokedAt: expect.any(Date), revokedById: "admin-1" },
    });
  });

  it("reports a concurrent use or revocation without overwriting it", async () => {
    mocks.db.adminInvite.findUnique.mockResolvedValue({
      id: "invite-1",
      usedAt: null,
      revokedAt: null,
    });
    mocks.db.adminInvite.updateMany.mockResolvedValue({ count: 0 });

    const response = await DELETE(request(), params());

    expect(response.status).toBe(409);
  });
});
