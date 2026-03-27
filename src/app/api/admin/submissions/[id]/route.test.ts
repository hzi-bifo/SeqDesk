import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    submission: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    study: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    sample: {
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

import { GET, DELETE, PATCH } from "./route";

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/admin/submissions/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not admin", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const response = await GET(new Request("http://localhost"), makeParams("sub-1"));

    expect(response.status).toBe(401);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost"), makeParams("sub-1"));

    expect(response.status).toBe(401);
  });

  it("returns 404 when submission not found", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.submission.findUnique.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost"), makeParams("nonexistent"));

    expect(response.status).toBe(404);
  });

  it("returns submission for admin", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    const submission = { id: "sub-1", entityType: "study", status: "SUBMITTED" };
    mocks.db.submission.findUnique.mockResolvedValue(submission);

    const response = await GET(new Request("http://localhost"), makeParams("sub-1"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe("sub-1");
  });
});

describe("DELETE /api/admin/submissions/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not admin", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await DELETE(new Request("http://localhost"), makeParams("sub-1"));

    expect(response.status).toBe(401);
  });

  it("returns 404 when submission not found", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.submission.findUnique.mockResolvedValue(null);

    const response = await DELETE(new Request("http://localhost"), makeParams("sub-1"));

    expect(response.status).toBe(404);
  });

  it("deletes a simple submission", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.submission.findUnique.mockResolvedValue({
      id: "sub-1",
      entityType: "sample",
      accessionNumbers: null,
      response: null,
    });
    mocks.db.submission.delete.mockResolvedValue({});

    const response = await DELETE(new Request("http://localhost"), makeParams("sub-1"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(mocks.db.submission.delete).toHaveBeenCalledWith({ where: { id: "sub-1" } });
  });

  it("clears accession numbers for test study submissions", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.submission.findUnique.mockResolvedValue({
      id: "sub-1",
      entityType: "study",
      entityId: "study-1",
      accessionNumbers: JSON.stringify({ study: "ERP123", "SAMPLE-1": "ERS001" }),
      response: JSON.stringify({ isTest: true }),
    });
    mocks.db.study.updateMany.mockResolvedValue({ count: 1 });
    mocks.db.sample.updateMany.mockResolvedValue({ count: 1 });
    mocks.db.submission.delete.mockResolvedValue({});

    const response = await DELETE(new Request("http://localhost"), makeParams("sub-1"));

    expect(response.status).toBe(200);
    expect(mocks.db.study.updateMany).toHaveBeenCalledWith({
      where: { id: "study-1", studyAccessionId: "ERP123" },
      data: {
        studyAccessionId: null,
        submitted: false,
        submittedAt: null,
        testRegisteredAt: null,
      },
    });
    expect(mocks.db.sample.updateMany).toHaveBeenCalledWith({
      where: {
        sampleId: "SAMPLE-1",
        studyId: "study-1",
        sampleAccessionNumber: "ERS001",
      },
      data: {
        sampleAccessionNumber: null,
      },
    });
  });

  it("only clears matching accession values when deleting a historical test submission", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.submission.findUnique.mockResolvedValue({
      id: "sub-old-test",
      entityType: "study",
      entityId: "study-1",
      accessionNumbers: JSON.stringify({
        study: "ERP-OLD-TEST",
        "SAMPLE-1": "ERS-OLD-TEST",
      }),
      response: JSON.stringify({ isTest: true }),
    });
    mocks.db.study.updateMany.mockResolvedValue({ count: 0 });
    mocks.db.sample.updateMany.mockResolvedValue({ count: 0 });
    mocks.db.submission.delete.mockResolvedValue({});

    const response = await DELETE(
      new Request("http://localhost"),
      makeParams("sub-old-test")
    );

    expect(response.status).toBe(200);
    expect(mocks.db.study.updateMany).toHaveBeenCalledWith({
      where: { id: "study-1", studyAccessionId: "ERP-OLD-TEST" },
      data: {
        studyAccessionId: null,
        submitted: false,
        submittedAt: null,
        testRegisteredAt: null,
      },
    });
    expect(mocks.db.sample.updateMany).toHaveBeenCalledWith({
      where: {
        sampleId: "SAMPLE-1",
        studyId: "study-1",
        sampleAccessionNumber: "ERS-OLD-TEST",
      },
      data: {
        sampleAccessionNumber: null,
      },
    });
  });
});

describe("PATCH /api/admin/submissions/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not admin", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const request = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ status: "CANCELLED" }),
    });

    const response = await PATCH(request, makeParams("sub-1"));

    expect(response.status).toBe(401);
  });

  it("returns 400 when status is missing", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });

    const request = new Request("http://localhost", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await PATCH(request, makeParams("sub-1"));

    expect(response.status).toBe(400);
  });

  it("returns 400 for invalid status value", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });

    const request = new Request("http://localhost", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "INVALID" }),
    });

    const response = await PATCH(request, makeParams("sub-1"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid status");
  });

  it("updates submission status", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    const updated = { id: "sub-1", status: "CANCELLED" };
    mocks.db.submission.update.mockResolvedValue(updated);

    const request = new Request("http://localhost", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "CANCELLED" }),
    });

    const response = await PATCH(request, makeParams("sub-1"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("CANCELLED");
    expect(mocks.db.submission.update).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: { status: "CANCELLED" },
    });
  });
});
