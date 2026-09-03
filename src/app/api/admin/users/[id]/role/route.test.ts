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
  user: { id: "admin-1", role: "FACILITY_ADMIN", isDemo: false },
};

function request(role: unknown) {
  return new NextRequest("http://localhost/api/admin/users/user-1/role", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role }),
  });
}

function params(id = "user-1") {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/admin/users/[id]/role", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires administrator access", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "member-1", role: "RESEARCHER" },
    });
    const response = await PATCH(request("FACILITY_ADMIN"), params());
    expect(response.status).toBe(403);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("promotes a member in a serializable transaction", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-1",
          role: "RESEARCHER",
          email: "member@example.test",
        }),
        count: vi.fn(),
        update: vi.fn().mockResolvedValue({
          id: "user-1",
          role: "FACILITY_ADMIN",
          email: "member@example.test",
        }),
      },
    };
    mocks.db.$transaction.mockImplementation(async (callback) => callback(tx));

    const response = await PATCH(request("FACILITY_ADMIN"), params());

    expect(response.status).toBe(200);
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: "FACILITY_ADMIN" } })
    );
    expect(tx.user.count).not.toHaveBeenCalled();
    expect(mocks.db.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: "Serializable",
    });
  });

  it("prevents demotion of the final administrator atomically", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "admin-1",
          role: "FACILITY_ADMIN",
          email: "admin@example.test",
        }),
        count: vi.fn().mockResolvedValue(1),
        update: vi.fn(),
      },
    };
    mocks.db.$transaction.mockImplementation(async (callback) => callback(tx));

    const response = await PATCH(request("RESEARCHER"), params("admin-1"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "FINAL_ADMINISTRATOR",
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("allows demotion when another administrator exists", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "admin-2",
          role: "FACILITY_ADMIN",
          email: "admin2@example.test",
        }),
        count: vi.fn().mockResolvedValue(2),
        update: vi.fn().mockResolvedValue({
          id: "admin-2",
          role: "RESEARCHER",
          email: "admin2@example.test",
        }),
      },
    };
    mocks.db.$transaction.mockImplementation(async (callback) => callback(tx));

    const response = await PATCH(request("RESEARCHER"), params("admin-2"));

    expect(response.status).toBe(200);
    expect(tx.user.update).toHaveBeenCalled();
  });
});
