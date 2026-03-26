import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  loadStudyFormSchema: vi.fn(),
  db: {
    study: {
      findUnique: vi.fn(),
    },
    sample: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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

import { POST, PUT, DELETE } from "./route";

const BASE_URL = "http://localhost:3000/api/studies/study-1/samples";

describe("POST /api/studies/[id]/samples", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.study.findUnique.mockResolvedValue({ userId: "user-1" });
    mocks.db.sample.updateMany.mockResolvedValue({ count: 1 });
    mocks.db.sample.findMany.mockResolvedValue([
      { id: "sample-1", checklistData: null, order: { userId: "user-1" } },
    ]);
    mocks.loadStudyFormSchema.mockResolvedValue({
      studyFields: [],
      perSampleFields: [],
      fields: [],
      groups: [],
      modules: {},
    });
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const req = new NextRequest(BASE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleIds: ["sample-1"] }),
    });
    const response = await POST(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(401);
  });

  it("assigns samples to a study", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleIds: ["sample-1"] }),
    });
    const response = await POST(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.assignedCount).toBe(1);
    expect(mocks.db.sample.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["sample-1"] } },
      data: { studyId: "study-1" },
    });
  });

  it("returns 400 when sampleIds is empty", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleIds: [] }),
    });
    const response = await POST(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(400);
  });

  it("returns 404 when study does not exist", async () => {
    mocks.db.study.findUnique.mockResolvedValue(null);
    const req = new NextRequest(BASE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleIds: ["sample-1"] }),
    });
    const response = await POST(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(404);
  });

  it("allows FACILITY_ADMIN to assign samples they do not own", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.sample.findMany.mockResolvedValue([
      { id: "sample-1", checklistData: null, order: { userId: "other-user" } },
    ]);

    const req = new NextRequest(BASE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleIds: ["sample-1"] }),
    });
    const response = await POST(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  it("saves perSampleData with metadata merging for researcher", async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-1",
        checklistData: JSON.stringify({ existing_field: "keep" }),
        order: { userId: "user-1" },
      },
    ]);
    mocks.loadStudyFormSchema.mockResolvedValue({
      studyFields: [],
      perSampleFields: [
        { id: "f1", name: "collection_date", label: "Collection Date", type: "text", order: 0, perSample: true },
      ],
      fields: [],
      groups: [],
      modules: {},
    });

    const req = new NextRequest(BASE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sampleIds: ["sample-1"],
        perSampleData: {
          "sample-1": { collection_date: "2024-01-01" },
        },
      }),
    });
    const response = await POST(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.db.sample.update).toHaveBeenCalledWith({
      where: { id: "sample-1" },
      data: {
        checklistData: JSON.stringify({
          existing_field: "keep",
          collection_date: "2024-01-01",
        }),
      },
    });
  });

  it("returns 500 when db throws an error", async () => {
    mocks.db.sample.updateMany.mockRejectedValue(new Error("DB failure"));

    const req = new NextRequest(BASE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleIds: ["sample-1"] }),
    });
    const response = await POST(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to assign samples");
  });

  it("returns 403 when assigning samples user does not own", async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      { id: "sample-1", checklistData: null, order: { userId: "other-user" } },
    ]);
    const req = new NextRequest(BASE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleIds: ["sample-1"] }),
    });
    const response = await POST(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(403);
  });
});

describe("PUT /api/studies/[id]/samples", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.study.findUnique.mockResolvedValue({ userId: "user-1" });
    mocks.db.sample.update.mockResolvedValue({ id: "sample-1" });
    mocks.db.sample.updateMany.mockResolvedValue({ count: 0 });
    mocks.loadStudyFormSchema.mockResolvedValue({
      studyFields: [],
      perSampleFields: [
        { id: "f1", name: "visible_sample", label: "V", type: "text", order: 0, perSample: true },
      ],
      fields: [],
      groups: [],
      modules: {},
    });
    mocks.db.sample.findMany.mockImplementation(async ({ where, select }) => {
      if (where?.studyId && select?.id) {
        return [{ id: "sample-1" }];
      }
      if (where?.id?.in && select?.id && select?.checklistData) {
        return [
          {
            id: "sample-1",
            checklistData: JSON.stringify({
              visible_sample: "old value",
              hidden_admin_sample: "keep me",
            }),
          },
        ];
      }
      return [];
    });
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleIds: ["sample-1"] }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(401);
  });

  it("returns 400 when sampleIds is not an array", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleIds: "not-array" }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(400);
  });

  it("preserves hidden facility-only per-sample values when a researcher updates", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sampleIds: ["sample-1"],
        perSampleData: {
          "sample-1": { visible_sample: "new value" },
        },
      }),
    });

    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.db.sample.update).toHaveBeenCalledWith({
      where: { id: "sample-1" },
      data: {
        checklistData: JSON.stringify({
          visible_sample: "new value",
          hidden_admin_sample: "keep me",
        }),
      },
    });
  });

  it("returns 404 when study does not exist", async () => {
    mocks.db.study.findUnique.mockResolvedValue(null);
    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleIds: ["sample-1"] }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(404);
  });

  it("handles both samplesToAdd and samplesToRemove", async () => {
    // Current study has sample-1; new sampleIds has sample-2 (add sample-2, remove sample-1)
    mocks.db.sample.findMany.mockImplementation(async ({ where, select, include }) => {
      if (where?.studyId && select?.id) {
        return [{ id: "sample-1" }];
      }
      if (where?.id?.in && include?.order) {
        return [{ id: "sample-2", order: { userId: "user-1" } }];
      }
      if (where?.id?.in && select?.id && select?.checklistData) {
        return [{ id: "sample-2", checklistData: null }];
      }
      return [];
    });

    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleIds: ["sample-2"] }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.added).toBe(1);
    expect(data.removed).toBe(1);
  });

  it("allows FACILITY_ADMIN to add unowned samples", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.sample.findMany.mockImplementation(async ({ where, select, include }) => {
      if (where?.studyId && select?.id) {
        return [];
      }
      if (where?.id?.in && include?.order) {
        return [{ id: "sample-1", order: { userId: "other-user" } }];
      }
      return [];
    });

    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleIds: ["sample-1"] }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.added).toBe(1);
  });

  it("returns 500 when db throws an error", async () => {
    mocks.db.study.findUnique.mockRejectedValue(new Error("DB failure"));

    const req = new NextRequest(BASE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleIds: ["sample-1"] }),
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to update samples");
  });
});

describe("DELETE /api/studies/[id]/samples", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.study.findUnique.mockResolvedValue({ userId: "user-1" });
    mocks.db.sample.updateMany.mockResolvedValue({ count: 1 });
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const req = new NextRequest(BASE_URL, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleIds: ["sample-1"] }),
    });
    const response = await DELETE(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(401);
  });

  it("unassigns samples from the study", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleIds: ["sample-1"] }),
    });
    const response = await DELETE(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.db.sample.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["sample-1"] }, studyId: "study-1" },
      data: { studyId: null },
    });
  });

  it("returns 400 when sampleIds is empty", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleIds: [] }),
    });
    const response = await DELETE(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(400);
  });

  it("returns 404 when study does not exist", async () => {
    mocks.db.study.findUnique.mockResolvedValue(null);
    const req = new NextRequest(BASE_URL, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleIds: ["sample-1"] }),
    });
    const response = await DELETE(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(404);
  });

  it("returns 403 for non-owner non-admin", async () => {
    mocks.db.study.findUnique.mockResolvedValue({ userId: "other-user" });
    const req = new NextRequest(BASE_URL, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleIds: ["sample-1"] }),
    });
    const response = await DELETE(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(403);
  });

  it("allows FACILITY_ADMIN to unassign samples from any study", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.study.findUnique.mockResolvedValue({ userId: "other-user" });

    const req = new NextRequest(BASE_URL, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleIds: ["sample-1"] }),
    });
    const response = await DELETE(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  it("returns 500 when db throws an error", async () => {
    mocks.db.study.findUnique.mockRejectedValue(new Error("DB failure"));

    const req = new NextRequest(BASE_URL, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleIds: ["sample-1"] }),
    });
    const response = await DELETE(req, { params: Promise.resolve({ id: "study-1" }) });
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to remove samples");
  });
});
