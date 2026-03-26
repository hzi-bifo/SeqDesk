import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    sample: {
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
const ownerSession = { user: { id: "user-1", role: "RESEARCHER" } };

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const sampleWithOrder = {
  id: "s1",
  sampleAlias: "alias",
  sampleTitle: "Sample 1",
  order: { id: "o1", userId: "user-1", orderNumber: 1 },
  study: null,
};

describe("GET /api/samples/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue(ownerSession);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/samples/s1");
    const res = await GET(req, makeParams("s1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when sample not found", async () => {
    mocks.db.sample.findUnique.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/samples/s1");
    const res = await GET(req, makeParams("s1"));
    expect(res.status).toBe(404);
  });

  it("returns sample for the owner", async () => {
    mocks.db.sample.findUnique.mockResolvedValue(sampleWithOrder);
    const req = new NextRequest("http://localhost/api/samples/s1");
    const res = await GET(req, makeParams("s1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe("s1");
  });

  it("returns 403 when non-owner non-admin accesses sample", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { id: "other-user", role: "RESEARCHER" } });
    mocks.db.sample.findUnique.mockResolvedValue(sampleWithOrder);
    const req = new NextRequest("http://localhost/api/samples/s1");
    const res = await GET(req, makeParams("s1"));
    expect(res.status).toBe(403);
  });

  it("allows facility admin to access any sample", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.sample.findUnique.mockResolvedValue(sampleWithOrder);
    const req = new NextRequest("http://localhost/api/samples/s1");
    const res = await GET(req, makeParams("s1"));
    expect(res.status).toBe(200);
  });
});

describe("PUT /api/samples/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue(ownerSession);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/samples/s1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleAlias: "new-alias" }),
    });
    const res = await PUT(req, makeParams("s1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when sample not found", async () => {
    mocks.db.sample.findUnique.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/samples/s1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleAlias: "new-alias" }),
    });
    const res = await PUT(req, makeParams("s1"));
    expect(res.status).toBe(404);
  });

  it("updates sample successfully", async () => {
    mocks.db.sample.findUnique.mockResolvedValue({
      id: "s1",
      order: { userId: "user-1" },
    });
    mocks.db.sample.update.mockResolvedValue({
      id: "s1",
      sampleAlias: "new-alias",
    });

    const req = new NextRequest("http://localhost/api/samples/s1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleAlias: "new-alias" }),
    });
    const res = await PUT(req, makeParams("s1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sampleAlias).toBe("new-alias");
  });
});

describe("DELETE /api/samples/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue(ownerSession);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/samples/s1", { method: "DELETE" });
    const res = await DELETE(req, makeParams("s1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when sample not found", async () => {
    mocks.db.sample.findUnique.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/samples/s1", { method: "DELETE" });
    const res = await DELETE(req, makeParams("s1"));
    expect(res.status).toBe(404);
  });

  it("returns 400 when order is not in DRAFT status for non-admin", async () => {
    mocks.db.sample.findUnique.mockResolvedValue({
      id: "s1",
      order: { userId: "user-1", status: "SUBMITTED" },
    });
    const req = new NextRequest("http://localhost/api/samples/s1", { method: "DELETE" });
    const res = await DELETE(req, makeParams("s1"));
    expect(res.status).toBe(400);
  });

  it("deletes sample in DRAFT order", async () => {
    mocks.db.sample.findUnique.mockResolvedValue({
      id: "s1",
      order: { userId: "user-1", status: "DRAFT" },
    });
    mocks.db.sample.delete.mockResolvedValue({ id: "s1" });

    const req = new NextRequest("http://localhost/api/samples/s1", { method: "DELETE" });
    const res = await DELETE(req, makeParams("s1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("allows admin to delete sample from non-DRAFT order", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.sample.findUnique.mockResolvedValue({
      id: "s1",
      order: { userId: "user-1", status: "SUBMITTED" },
    });
    mocks.db.sample.delete.mockResolvedValue({ id: "s1" });

    const req = new NextRequest("http://localhost/api/samples/s1", { method: "DELETE" });
    const res = await DELETE(req, makeParams("s1"));
    expect(res.status).toBe(200);
  });
});
