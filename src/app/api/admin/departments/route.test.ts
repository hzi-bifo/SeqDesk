import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    department: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
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

describe("GET /api/admin/departments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns departments for admin", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const deps = [{ id: "d1", name: "Bio", _count: { users: 2 } }];
    mocks.db.department.findMany.mockResolvedValue(deps);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(deps);
  });

  it("returns 401 for non-admin", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "RESEARCHER" },
    });

    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 401 when no session", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 500 on db error", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.department.findMany.mockRejectedValue(new Error("db down"));

    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe("POST /api/admin/departments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a department", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.department.findUnique.mockResolvedValue(null);
    mocks.db.department.create.mockResolvedValue({
      id: "d1",
      name: "Genomics",
      description: null,
    });

    const req = new NextRequest("http://localhost/api/admin/departments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Genomics" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(mocks.db.department.create).toHaveBeenCalledTimes(1);
  });

  it("returns 401 for non-admin", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/admin/departments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "X" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when name is empty", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);

    const req = new NextRequest("http://localhost/api/admin/departments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when department name already exists", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.department.findUnique.mockResolvedValue({ id: "d1", name: "Bio" });

    const req = new NextRequest("http://localhost/api/admin/departments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Bio" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("already exists");
  });
});
