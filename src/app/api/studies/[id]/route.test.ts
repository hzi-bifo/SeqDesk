import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  loadStudyFormSchema: vi.fn(),
  db: {
    study: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    sample: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    assembly: {
      findMany: vi.fn(),
    },
    order: {
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

vi.mock("@/lib/studies/schema", () => ({
  loadStudyFormSchema: mocks.loadStudyFormSchema,
}));

import { GET, PUT, DELETE } from "./route";

function buildFetchedStudy(overrides: Record<string, unknown> = {}) {
  return {
    id: "study-1",
    title: "Study 1",
    alias: null,
    description: "Description",
    checklistType: "soil",
    studyMetadata: null,
    readyForSubmission: false,
    readyAt: null,
    studyAccessionId: null,
    submitted: false,
    submittedAt: null,
    testRegisteredAt: null,
    createdAt: new Date("2026-03-01"),
    updatedAt: new Date("2026-03-01"),
    userId: "user-1",
    user: {
      id: "user-1",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
    },
    samples: [],
    notes: null,
    notesEditedAt: null,
    notesEditedById: null,
    notesEditedBy: null,
    ...overrides,
  };
}

function setupFindUniqueMock(studyOverrides: Record<string, unknown> = {}) {
  mocks.db.study.findUnique.mockImplementation(async ({ select }) => {
    // resolveStudyId call (select: { id: true })
    if (select?.id && !select?.title) {
      return { id: "study-1" };
    }
    // fetchStudyWithNotes / fetchStudyWithoutNotes (has title + samples)
    if (select?.title && select?.samples) {
      return buildFetchedStudy(studyOverrides);
    }
    // ownership check (userId)
    if (select?.userId) {
      return { userId: studyOverrides.userId ?? "user-1", ...(select.submitted ? { submitted: studyOverrides.submitted ?? false } : {}), ...(select.studyMetadata ? { studyMetadata: studyOverrides.studyMetadata ?? null } : {}) };
    }
    return null;
  });
}

const BASE_URL = "http://localhost:3000/api/studies/study-1";

describe("GET /api/studies/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.study.findFirst.mockResolvedValue(null);
    mocks.db.sample.findMany.mockResolvedValue([]);
    mocks.db.assembly.findMany.mockResolvedValue([]);
    mocks.db.order.findMany.mockResolvedValue([]);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const req = new NextRequest(BASE_URL);
    const response = await GET(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(401);
  });

  it("returns study for the owner", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    setupFindUniqueMock();

    const req = new NextRequest(BASE_URL);
    const response = await GET(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.id).toBe("study-1");
  });

  it("returns 404 for non-existent study", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.study.findUnique.mockResolvedValue(null);

    const req = new NextRequest(BASE_URL);
    const response = await GET(req, { params: Promise.resolve({ id: "missing" }) });
    expect(response.status).toBe(404);
  });

  it("returns 403 when non-admin accesses another user's study", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "other-user", role: "RESEARCHER" },
    });
    setupFindUniqueMock({ userId: "user-1" });

    const req = new NextRequest(BASE_URL);
    const response = await GET(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(403);
  });

  it("allows FACILITY_ADMIN to access any study", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    setupFindUniqueMock({ userId: "user-1" });

    const req = new NextRequest(BASE_URL);
    const response = await GET(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
  });
});

describe("PUT /api/studies/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.loadStudyFormSchema.mockResolvedValue({
      studyFields: [{ id: "f1", name: "visible_field", label: "V", type: "text", order: 0 }],
      perSampleFields: [],
      fields: [],
      groups: [],
      modules: {},
    });
    mocks.db.study.findFirst.mockResolvedValue(null);
    mocks.db.study.update.mockResolvedValue({ id: "study-1" });
    mocks.db.sample.findMany.mockResolvedValue([]);
    mocks.db.assembly.findMany.mockResolvedValue([]);
    mocks.db.order.findMany.mockResolvedValue([]);
    setupFindUniqueMock({
      studyMetadata: JSON.stringify({
        visible_field: "old",
        hidden_admin_only: "keep",
      }),
    });
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "New Title" }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(401);
  });

  it("updates study title", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Updated Title" }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.db.study.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "Updated Title" }),
      })
    );
  });

  it("returns 400 for invalid body", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: 123 }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(400);
  });

  it("preserves hidden facility-only study metadata when a researcher updates", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        studyMetadata: { visible_field: "new visible value" },
      }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.db.study.update).toHaveBeenCalledWith({
      where: { id: "study-1" },
      data: {
        studyMetadata: JSON.stringify({
          visible_field: "new visible value",
          hidden_admin_only: "keep",
        }),
      },
    });
  });
});

describe("DELETE /api/studies/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.study.findFirst.mockResolvedValue(null);
    mocks.db.sample.updateMany.mockResolvedValue({ count: 0 });
    mocks.db.study.delete.mockResolvedValue({ id: "study-1" });
    setupFindUniqueMock();
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const req = new NextRequest(BASE_URL, { method: "DELETE" });
    const response = await DELETE(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(401);
  });

  it("deletes a study and unassigns samples", async () => {
    const req = new NextRequest(BASE_URL, { method: "DELETE" });
    const response = await DELETE(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.db.sample.updateMany).toHaveBeenCalledWith({
      where: { studyId: "study-1" },
      data: { studyId: null },
    });
    expect(mocks.db.study.delete).toHaveBeenCalledWith({ where: { id: "study-1" } });
  });

  it("returns 400 when trying to delete a submitted study", async () => {
    setupFindUniqueMock({ submitted: true });
    const req = new NextRequest(BASE_URL, { method: "DELETE" });
    const response = await DELETE(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(400);
  });

  it("returns 404 for non-existent study", async () => {
    mocks.db.study.findUnique.mockResolvedValue(null);
    const req = new NextRequest(BASE_URL, { method: "DELETE" });
    const response = await DELETE(req, { params: Promise.resolve({ id: "missing" }) });
    expect(response.status).toBe(404);
  });
});
