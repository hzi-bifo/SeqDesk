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

  it("returns 403 when non-admin tries to delete another user's study", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "other-user", role: "RESEARCHER" },
    });
    setupFindUniqueMock({ userId: "user-1" });

    const req = new NextRequest(BASE_URL, { method: "DELETE" });
    const response = await DELETE(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(403);
  });

  it("allows FACILITY_ADMIN to delete any study", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    setupFindUniqueMock({ userId: "user-1" });

    const req = new NextRequest(BASE_URL, { method: "DELETE" });
    const response = await DELETE(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.db.study.delete).toHaveBeenCalled();
  });
});

describe("PUT /api/studies/[id] - additional edge cases", () => {
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
    setupFindUniqueMock();
  });

  it("returns 403 when non-admin tries to update another user's study", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "other-user", role: "RESEARCHER" },
    });
    setupFindUniqueMock({ userId: "user-1" });

    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Hacked" }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(403);
  });

  it("updates study description to null", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: null }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.db.study.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ description: null }),
      })
    );
  });

  it("updates study alias", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: "my-alias" }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.db.study.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ alias: "my-alias" }),
      })
    );
  });

  it("updates readyForSubmission to true and sets readyAt", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ readyForSubmission: true }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.db.study.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          readyForSubmission: true,
          readyAt: expect.any(Date),
        }),
      })
    );
  });

  it("updates readyForSubmission to false and clears readyAt", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ readyForSubmission: false }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.db.study.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          readyForSubmission: false,
          readyAt: null,
        }),
      })
    );
  });

  it("updates notes and sets notesEditedAt and notesEditedById", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "New note content" }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.db.study.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          notes: "New note content",
          notesEditedAt: expect.any(Date),
          notesEditedById: "user-1",
        }),
      })
    );
  });

  it("returns 400 for invalid description type", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: 123 }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(400);
  });

  it("returns 400 for invalid alias type", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: 123 }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(400);
  });

  it("returns 400 for invalid checklistType", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ checklistType: 123 }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(400);
  });

  it("returns 400 for invalid readyForSubmission type", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ readyForSubmission: "yes" }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(400);
  });

  it("returns 400 for invalid notes type", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: 123 }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(400);
  });

  it("returns 400 for array body", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ title: "New" }]),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(400);
  });

  it("returns 404 when study not found for PUT", async () => {
    mocks.db.study.findUnique.mockResolvedValue(null);

    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "New Title" }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "missing" }) });
    expect(response.status).toBe(404);
  });

  it("allows FACILITY_ADMIN to update any study", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    setupFindUniqueMock({ userId: "user-1" });

    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Admin Updated" }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
  });

  it("FACILITY_ADMIN can set studyMetadata directly as string", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    setupFindUniqueMock({ userId: "user-1" });

    const metadataString = JSON.stringify({ admin_field: "admin_value" });
    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ studyMetadata: metadataString }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.db.study.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          studyMetadata: metadataString,
        }),
      })
    );
  });

  it("retries update without notes fields when missing column error occurs", async () => {
    const missingColumnError = new Error("no such column: notes") as Error & { code?: string };
    missingColumnError.code = "P2022";
    mocks.db.study.update
      .mockRejectedValueOnce(missingColumnError)
      .mockResolvedValueOnce({ id: "study-1" });

    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Updated", notes: "Some notes" }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.db.study.update).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/studies/[id] - additional edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.study.findFirst.mockResolvedValue(null);
    mocks.db.sample.findMany.mockResolvedValue([]);
    mocks.db.assembly.findMany.mockResolvedValue([]);
    mocks.db.order.findMany.mockResolvedValue([]);
  });

  it("returns study with samples that have assemblies and orders", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    const studyWithSamples = buildFetchedStudy({
      samples: [
        {
          id: "sample-1",
          sampleId: "S1",
          sampleAlias: null,
          sampleTitle: null,
          sampleAccessionNumber: null,
          taxId: null,
          scientificName: null,
          checklistData: null,
          customFields: null,
          orderId: "order-1",
          reads: [],
        },
      ],
    });
    mocks.db.study.findUnique.mockImplementation(async ({ select }: { select?: Record<string, unknown> }) => {
      if (select?.id && !select?.title) return { id: "study-1" };
      if (select?.title && select?.samples) return studyWithSamples;
      if (select?.userId) return { userId: "user-1" };
      if (select?.preferredAssemblyId) {
        return [{ id: "sample-1", preferredAssemblyId: null }];
      }
      return null;
    });
    mocks.db.sample.findMany.mockResolvedValue([
      { id: "sample-1", preferredAssemblyId: null },
    ]);
    mocks.db.assembly.findMany.mockResolvedValue([
      {
        id: "asm-1",
        sampleId: "sample-1",
        assemblyName: "megahit",
        assemblyFile: "/path/assembly.fa",
        createdByPipelineRunId: null,
        createdByPipelineRun: null,
      },
    ]);
    mocks.db.order.findMany.mockResolvedValue([
      { id: "order-1", orderNumber: "ORD-001", name: "Order 1", status: "SUBMITTED" },
    ]);

    const req = new NextRequest(BASE_URL);
    const response = await GET(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.samples).toHaveLength(1);
    expect(data.samples[0].assemblies).toHaveLength(1);
    expect(data.samples[0].order).toBeTruthy();
    expect(data.samples[0].order.orderNumber).toBe("ORD-001");
  });

  it("resolves study by alias when direct ID lookup fails", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    const calls: number[] = [];
    mocks.db.study.findUnique.mockImplementation(async ({ select }: { select?: Record<string, unknown> }) => {
      calls.push(1);
      // First call is resolveStudyId by id - returns null
      if (calls.length === 1) return null;
      // After findFirst resolves, subsequent calls use "study-1"
      if (select?.title && select?.samples) return buildFetchedStudy();
      if (select?.userId) return { userId: "user-1" };
      return { id: "study-1" };
    });
    mocks.db.study.findFirst.mockResolvedValue({ id: "study-1" });

    const req = new NextRequest("http://localhost:3000/api/studies/my-alias");
    const response = await GET(req, { params: Promise.resolve({ id: "my-alias" }) });
    expect(response.status).toBe(200);
    expect(mocks.db.study.findFirst).toHaveBeenCalled();
  });

  it("returns 500 on unexpected database error", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.study.findUnique.mockRejectedValue(new Error("DB crashed"));

    const req = new NextRequest(BASE_URL);
    const response = await GET(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(500);
  });
});
