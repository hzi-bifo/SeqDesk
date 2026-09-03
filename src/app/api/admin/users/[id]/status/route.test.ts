import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: { $transaction: vi.fn() },
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));

import { PATCH } from "./route";

const adminSession = {
  user: {
    id: "admin-1",
    systemRole: "ADMIN",
    role: "RESEARCHER",
    isDemo: false,
  },
};

function request(isActive: unknown) {
  return new NextRequest("http://localhost/api/admin/users/user-1/status", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ isActive }),
  });
}

function params(id = "user-1") {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/admin/users/[id]/status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires administrator access", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "member-1", systemRole: "MEMBER", role: "RESEARCHER" },
    });

    const response = await PATCH(request(false), params());

    expect(response.status).toBe(403);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("deactivates a member reversibly in a serializable transaction", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-1",
          email: "member@example.test",
          systemRole: "MEMBER",
          isActive: true,
          deactivatedAt: null,
        }),
        count: vi.fn(),
        update: vi.fn().mockResolvedValue({
          id: "user-1",
          email: "member@example.test",
          systemRole: "MEMBER",
          isActive: false,
          deactivatedAt: new Date("2026-09-03T12:00:00Z"),
        }),
      },
      adminInvite: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    mocks.db.$transaction.mockImplementation(async (callback) => callback(tx));

    const response = await PATCH(request(false), params());

    expect(response.status).toBe(200);
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: { isActive: false, deactivatedAt: expect.any(Date) },
      })
    );
    expect(tx.user.count).not.toHaveBeenCalled();
    expect(tx.adminInvite.updateMany).toHaveBeenCalledWith({
      where: { createdById: "user-1", usedAt: null, revokedAt: null },
      data: { revokedAt: expect.any(Date), revokedById: "admin-1" },
    });
    expect(mocks.db.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: "Serializable",
    });
  });

  it("prevents deactivation of the final active administrator atomically", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "admin-1",
          email: "admin@example.test",
          systemRole: "ADMIN",
          isActive: true,
          deactivatedAt: null,
        }),
        count: vi.fn().mockResolvedValue(1),
        update: vi.fn(),
      },
    };
    mocks.db.$transaction.mockImplementation(async (callback) => callback(tx));

    const response = await PATCH(request(false), params("admin-1"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "FINAL_ADMINISTRATOR",
    });
    expect(tx.user.count).toHaveBeenCalledWith({
      where: { systemRole: "ADMIN", isActive: true },
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("allows administrator deactivation when another active administrator exists", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "admin-2",
          email: "admin2@example.test",
          systemRole: "ADMIN",
          isActive: true,
          deactivatedAt: null,
        }),
        count: vi.fn().mockResolvedValue(2),
        update: vi.fn().mockResolvedValue({
          id: "admin-2",
          email: "admin2@example.test",
          systemRole: "ADMIN",
          isActive: false,
          deactivatedAt: new Date("2026-09-03T12:00:00Z"),
        }),
      },
      adminInvite: { updateMany: vi.fn().mockResolvedValue({ count: 3 }) },
    };
    mocks.db.$transaction.mockImplementation(async (callback) => callback(tx));

    const response = await PATCH(request(false), params("admin-2"));

    expect(response.status).toBe(200);
    expect(tx.user.count).toHaveBeenCalledWith({
      where: { systemRole: "ADMIN", isActive: true },
    });
    expect(tx.user.update).toHaveBeenCalled();
    expect(tx.adminInvite.updateMany).toHaveBeenCalled();
  });

  it("reactivates an account and clears its deactivation timestamp", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-1",
          email: "member@example.test",
          systemRole: "MEMBER",
          isActive: false,
          deactivatedAt: new Date("2026-09-02T12:00:00Z"),
        }),
        count: vi.fn(),
        update: vi.fn().mockResolvedValue({
          id: "user-1",
          email: "member@example.test",
          systemRole: "MEMBER",
          isActive: true,
          deactivatedAt: null,
        }),
      },
      adminInvite: { updateMany: vi.fn() },
    };
    mocks.db.$transaction.mockImplementation(async (callback) => callback(tx));

    const response = await PATCH(request(true), params());

    expect(response.status).toBe(200);
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { isActive: true, deactivatedAt: null },
      })
    );
    expect(tx.adminInvite.updateMany).not.toHaveBeenCalled();
  });

  it("rejects malformed status changes", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);

    const response = await PATCH(request("false"), params());

    expect(response.status).toBe(400);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("retries a serializable transaction conflict", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-1",
          email: "member@example.test",
          systemRole: "MEMBER",
          isActive: true,
          deactivatedAt: null,
        }),
        count: vi.fn(),
        update: vi.fn().mockResolvedValue({
          id: "user-1",
          email: "member@example.test",
          systemRole: "MEMBER",
          isActive: false,
          deactivatedAt: new Date("2026-09-03T12:00:00Z"),
        }),
      },
      adminInvite: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    mocks.db.$transaction
      .mockRejectedValueOnce({ code: "P2034" })
      .mockImplementationOnce(async (callback) => callback(tx));

    const response = await PATCH(request(false), params());

    expect(response.status).toBe(200);
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(2);
  });
});
