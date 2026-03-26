import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    user: {
      findMany: vi.fn(),
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

import { GET } from "./route";

const adminSession = { user: { id: "admin-1", role: "FACILITY_ADMIN" } };

describe("GET /api/admin/users", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns users for admin with default RESEARCHER role filter", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const users = [{ id: "u1", name: "Alice", role: "RESEARCHER" }];
    mocks.db.user.findMany.mockResolvedValue(users);

    const req = new NextRequest("http://localhost/api/admin/users");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(users);
    expect(mocks.db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: "RESEARCHER" },
      })
    );
  });

  it("filters by role query param", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.user.findMany.mockResolvedValue([]);

    const req = new NextRequest(
      "http://localhost/api/admin/users?role=FACILITY_ADMIN"
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mocks.db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: "FACILITY_ADMIN" },
      })
    );
  });

  it("returns 401 for non-admin", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "RESEARCHER" },
    });

    const req = new NextRequest("http://localhost/api/admin/users");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 when no session", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/admin/users");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
