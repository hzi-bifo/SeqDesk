import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    department: {
      findUnique: vi.fn(),
      update: vi.fn(),
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

import { GET, PUT, DELETE } from "./route";

const adminSession = { user: { id: "admin-1", role: "FACILITY_ADMIN" } };
const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/admin/departments/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a department", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const dept = { id: "d1", name: "Bio", _count: { users: 3 } };
    mocks.db.department.findUnique.mockResolvedValue(dept);

    const req = new NextRequest("http://localhost/api/admin/departments/d1");
    const res = await GET(req, makeParams("d1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(dept);
  });

  it("returns 401 for non-admin", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/admin/departments/d1");
    const res = await GET(req, makeParams("d1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when not found", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.department.findUnique.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/admin/departments/d1");
    const res = await GET(req, makeParams("d1"));
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/admin/departments/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates a department", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.department.findUnique
      .mockResolvedValueOnce({ id: "d1", name: "Bio" }) // existing check
      .mockResolvedValueOnce(null); // duplicate name check
    mocks.db.department.update.mockResolvedValue({ id: "d1", name: "Biology" });

    const req = new NextRequest("http://localhost/api/admin/departments/d1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Biology" }),
    });

    const res = await PUT(req, makeParams("d1"));
    expect(res.status).toBe(200);
    expect(mocks.db.department.update).toHaveBeenCalledTimes(1);
  });

  it("returns 401 for non-admin", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/admin/departments/d1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "X" }),
    });

    const res = await PUT(req, makeParams("d1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when department not found", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.department.findUnique.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/admin/departments/d1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "X" }),
    });

    const res = await PUT(req, makeParams("d1"));
    expect(res.status).toBe(404);
  });

  it("returns 400 when renaming to duplicate name", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    // First call: find existing department being updated
    // Second call: find duplicate with the new name
    mocks.db.department.findUnique
      .mockResolvedValueOnce({ id: "d1", name: "Bio" })
      .mockResolvedValueOnce({ id: "d2", name: "Chemistry" });

    const req = new NextRequest("http://localhost/api/admin/departments/d1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Chemistry" }),
    });

    const res = await PUT(req, makeParams("d1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("already exists");
  });
});

describe("DELETE /api/admin/departments/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes a department with no users", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.department.findUnique.mockResolvedValue({
      id: "d1",
      name: "Bio",
      _count: { users: 0 },
    });
    mocks.db.department.delete.mockResolvedValue({});

    const req = new NextRequest("http://localhost/api/admin/departments/d1", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("d1"));
    expect(res.status).toBe(200);
    expect(mocks.db.department.delete).toHaveBeenCalledTimes(1);
  });

  it("returns 401 for non-admin", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/admin/departments/d1", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("d1"));
    expect(res.status).toBe(401);
  });

  it("returns 400 when department has users", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.department.findUnique.mockResolvedValue({
      id: "d1",
      name: "Bio",
      _count: { users: 5 },
    });

    const req = new NextRequest("http://localhost/api/admin/departments/d1", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("d1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Cannot delete");
  });

  it("returns 404 when department not found", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.department.findUnique.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/admin/departments/d1", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("d1"));
    expect(res.status).toBe(404);
  });
});
