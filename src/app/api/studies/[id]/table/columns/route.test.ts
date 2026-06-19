import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    study: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));

import { POST, DELETE } from "./route";

const params = Promise.resolve({ id: "study-1" });
const body = (payload: unknown) =>
  new Request("http://localhost/api/studies/study-1/table/columns", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

function adminSession() {
  return { user: { id: "admin-1", role: "FACILITY_ADMIN" } };
}

function savedMixsColumns() {
  const arg = mocks.db.study.update.mock.calls[0][0];
  return JSON.parse(arg.data.studyMetadata);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getServerSession.mockResolvedValue(adminSession());
  mocks.db.study.findUnique.mockResolvedValue({
    id: "study-1",
    userId: "user-1",
    studyMetadata: JSON.stringify({ abstract: "keep", _mixsColumns: ["ph"] }),
  });
  mocks.db.study.findFirst.mockResolvedValue(null);
  mocks.db.study.update.mockResolvedValue({});
});

describe("POST/DELETE /api/studies/[id]/table/columns", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const res = await POST(body({ fieldName: "depth" }), { params });
    expect(res.status).toBe(401);
  });

  it("returns 400 when fieldName is missing", async () => {
    const res = await POST(body({}), { params });
    expect(res.status).toBe(400);
  });

  it("returns 403 for a non-admin editing someone else's study", async () => {
    mocks.getServerSession.mockResolvedValueOnce({
      user: { id: "other", role: "RESEARCHER" },
    });
    const res = await POST(body({ fieldName: "depth" }), { params });
    expect(res.status).toBe(403);
  });

  it("adds a field to _mixsColumns and preserves other metadata", async () => {
    const res = await POST(body({ fieldName: "depth" }), { params });
    expect(res.status).toBe(200);
    const meta = savedMixsColumns();
    expect(meta._mixsColumns).toEqual(["ph", "depth"]);
    expect(meta.abstract).toBe("keep");
  });

  it("does not duplicate an already-added field", async () => {
    const res = await POST(body({ fieldName: "ph" }), { params });
    expect(res.status).toBe(200);
    expect(savedMixsColumns()._mixsColumns).toEqual(["ph"]);
  });

  it("removes a field on DELETE", async () => {
    const res = await DELETE(body({ fieldName: "ph" }), { params });
    expect(res.status).toBe(200);
    expect(savedMixsColumns()._mixsColumns).toEqual([]);
  });
});
