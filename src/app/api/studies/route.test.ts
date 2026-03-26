import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    study: {
      findMany: vi.fn(),
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

const BASE_URL = "http://localhost:3000/api/studies";

describe("GET /api/studies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns studies for the current user", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.study.findMany.mockResolvedValue([
      {
        id: "study-1",
        title: "Test Study",
        description: null,
        checklistType: null,
        submitted: false,
        readyForSubmission: false,
        submittedAt: null,
        studyAccessionId: null,
        createdAt: new Date(),
        user: { id: "user-1", firstName: "A", lastName: "B", email: "a@b.c" },
        samples: [
          { id: "s1", checklistData: null, reads: [{ id: "r1", file1: "/f1.fq", file2: null }] },
          { id: "s2", checklistData: null, reads: [] },
        ],
        _count: { samples: 2 },
      },
    ]);

    const response = await GET();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveLength(1);
    expect(data[0].samplesWithReads).toBe(1);
  });

  it("filters by userId for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.study.findMany.mockResolvedValue([]);

    await GET();
    expect(mocks.db.study.findMany.mock.calls[0][0].where).toEqual({ userId: "user-1" });
  });

  it("returns all studies for FACILITY_ADMIN", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.study.findMany.mockResolvedValue([]);

    await GET();
    expect(mocks.db.study.findMany.mock.calls[0][0].where).toEqual({});
  });

  it("returns 500 when db throws", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.study.findMany.mockRejectedValue(new Error("db error"));

    const response = await GET();
    expect(response.status).toBe(500);
  });
});

describe("POST /api/studies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.study.create.mockImplementation(async ({ data }) => ({
      id: "study-1",
      ...data,
    }));
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const req = new NextRequest(BASE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Test" }),
    });
    const response = await POST(req);
    expect(response.status).toBe(401);
  });

  it("creates a study with valid data", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "My Study", description: "desc" }),
    });

    const response = await POST(req);
    expect(response.status).toBe(201);
    const args = mocks.db.study.create.mock.calls[0][0].data;
    expect(args.title).toBe("My Study");
    expect(args.description).toBe("desc");
    expect(args.userId).toBe("user-1");
  });

  it("returns 400 when title is missing", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "no title" }),
    });
    const response = await POST(req);
    expect(response.status).toBe(400);
  });

  it("returns 400 when title is whitespace-only", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "   " }),
    });
    const response = await POST(req);
    expect(response.status).toBe(400);
  });

  it("marks studies as E2E-generated when the Playwright header is present", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-seqdesk-e2e": "playwright",
      },
      body: JSON.stringify({ title: "Playwright study" }),
    });

    const response = await POST(req);
    expect(response.status).toBe(201);
    const args = mocks.db.study.create.mock.calls[0][0].data;
    expect(args.generatedByE2E).toBe(true);
  });

  it("leaves generatedByE2E false for normal study creation", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Manual study" }),
    });

    const response = await POST(req);
    expect(response.status).toBe(201);
    const args = mocks.db.study.create.mock.calls[0][0].data;
    expect(args.generatedByE2E).toBe(false);
  });
});
