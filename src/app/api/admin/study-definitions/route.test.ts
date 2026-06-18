import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  seedStudyFormConfig: vi.fn(),
  db: {
    study: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/studies/per-study-config", () => ({
  seedStudyFormConfig: mocks.seedStudyFormConfig,
}));

import { GET, POST } from "./route";

function postReq(body: unknown) {
  return new NextRequest("http://localhost/api/admin/study-definitions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/admin/study-definitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
  });

  it("returns 401 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u", role: "RESEARCHER" },
    });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("maps studies to sampleCount and hasFormConfig and drops the raw relation", async () => {
    mocks.db.study.findMany.mockResolvedValue([
      {
        id: "s1",
        title: "A",
        alias: null,
        checklistType: null,
        submitted: false,
        createdAt: new Date("2026-01-01"),
        user: { firstName: "X", lastName: "Y", email: "x@y.z" },
        _count: { samples: 3 },
        studyFormConfig: { id: "cfg1" },
      },
      {
        id: "s2",
        title: "B",
        alias: null,
        checklistType: "soil",
        submitted: true,
        createdAt: new Date("2026-01-02"),
        user: { firstName: "X", lastName: "Y", email: "x@y.z" },
        _count: { samples: 0 },
        studyFormConfig: null,
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0]).toMatchObject({ id: "s1", sampleCount: 3, hasFormConfig: true });
    expect(body[1]).toMatchObject({ id: "s2", sampleCount: 0, hasFormConfig: false });
    expect(body[0].studyFormConfig).toBeUndefined();
  });
});

describe("POST /api/admin/study-definitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.study.create.mockResolvedValue({ id: "new-study", title: "New" });
    mocks.seedStudyFormConfig.mockResolvedValue({});
  });

  it("returns 401 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u", role: "RESEARCHER" },
    });
    const res = await POST(postReq({ title: "X" }));
    expect(res.status).toBe(401);
    expect(mocks.db.study.create).not.toHaveBeenCalled();
  });

  it("returns 400 when title is blank", async () => {
    const res = await POST(postReq({ title: "   " }));
    expect(res.status).toBe(400);
    expect(mocks.db.study.create).not.toHaveBeenCalled();
  });

  it("creates the study and seeds a blank questionnaire by default", async () => {
    const res = await POST(postReq({ title: "New Study" }));
    expect(res.status).toBe(201);
    expect(mocks.db.study.create).toHaveBeenCalledWith({
      data: { title: "New Study", userId: "admin-1" },
    });
    expect(mocks.seedStudyFormConfig).toHaveBeenCalledWith("new-study", {
      mode: "blank",
    });
  });

  it("seeds by cloning when seedMode is clone with a source", async () => {
    const res = await POST(
      postReq({ title: "Cloned", seedMode: "clone", cloneFromStudyId: "src-1" })
    );
    expect(res.status).toBe(201);
    expect(mocks.seedStudyFormConfig).toHaveBeenCalledWith("new-study", {
      mode: "clone",
      sourceStudyId: "src-1",
    });
  });

  it("falls back to blank seeding when clone is requested without a source", async () => {
    const res = await POST(postReq({ title: "NoSource", seedMode: "clone" }));
    expect(res.status).toBe(201);
    expect(mocks.seedStudyFormConfig).toHaveBeenCalledWith("new-study", {
      mode: "blank",
    });
  });
});
