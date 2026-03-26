import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    sample: {
      findUnique: vi.fn(),
      update: vi.fn(),
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
const ownerSession = { user: { id: "user-1", role: "RESEARCHER" } };
const otherSession = { user: { id: "user-2", role: "RESEARCHER" } };

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const sampleWithOrder = {
  id: "s1",
  order: { userId: "user-1" },
};

describe("DELETE /api/samples/[id]/study", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/samples/s1/study", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("s1"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 404 when sample not found", async () => {
    mocks.getServerSession.mockResolvedValue(ownerSession);
    mocks.db.sample.findUnique.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/samples/s1/study", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("s1"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Sample not found" });
  });

  it("returns 403 when user is not owner and not admin", async () => {
    mocks.getServerSession.mockResolvedValue(otherSession);
    mocks.db.sample.findUnique.mockResolvedValue(sampleWithOrder);
    const req = new NextRequest("http://localhost/api/samples/s1/study", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("s1"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  it("returns 200 on success for owner", async () => {
    mocks.getServerSession.mockResolvedValue(ownerSession);
    mocks.db.sample.findUnique.mockResolvedValue(sampleWithOrder);
    mocks.db.sample.update.mockResolvedValue({});
    const req = new NextRequest("http://localhost/api/samples/s1/study", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mocks.db.sample.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { studyId: null },
    });
  });

  it("returns 200 on success for admin", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.sample.findUnique.mockResolvedValue({
      id: "s1",
      order: { userId: "someone-else" },
    });
    mocks.db.sample.update.mockResolvedValue({});
    const req = new NextRequest("http://localhost/api/samples/s1/study", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it("returns 500 on database error", async () => {
    mocks.getServerSession.mockResolvedValue(ownerSession);
    mocks.db.sample.findUnique.mockRejectedValue(new Error("DB error"));
    const req = new NextRequest("http://localhost/api/samples/s1/study", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("s1"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to unassign sample" });
  });
});
