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

import { PUT } from "./route";

const adminSession = { user: { id: "admin-1", role: "FACILITY_ADMIN" } };
const ownerSession = { user: { id: "user-1", role: "RESEARCHER" } };
const otherSession = { user: { id: "user-2", role: "RESEARCHER" } };

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const baseSample = {
  id: "s1",
  sampleId: "SAMPLE-001",
  studyId: "study-1",
  order: { userId: "user-1" },
  study: { id: "study-1", userId: "user-1" },
  assemblies: [
    {
      id: "asm-1",
      assemblyName: "Assembly 1",
      assemblyFile: "/path/to/assembly.fasta",
      createdByPipelineRunId: "run-1",
      createdByPipelineRun: {
        id: "run-1",
        runNumber: 1,
        status: "COMPLETED",
        createdAt: "2024-01-01",
        completedAt: "2024-01-02",
      },
    },
    {
      id: "asm-2",
      assemblyName: "Assembly 2",
      assemblyFile: null,
      createdByPipelineRunId: "run-2",
      createdByPipelineRun: {
        id: "run-2",
        runNumber: 2,
        status: "COMPLETED",
        createdAt: "2024-01-03",
        completedAt: "2024-01-04",
      },
    },
  ],
};

describe("PUT /api/samples/[id]/preferred-assembly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const req = new NextRequest(
      "http://localhost/api/samples/s1/preferred-assembly",
      {
        method: "PUT",
        body: JSON.stringify({ assemblyId: "asm-1" }),
      }
    );

    const res = await PUT(req, makeParams("s1"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 400 when assemblyId is invalid type", async () => {
    mocks.getServerSession.mockResolvedValue(ownerSession);
    const req = new NextRequest(
      "http://localhost/api/samples/s1/preferred-assembly",
      {
        method: "PUT",
        body: JSON.stringify({ assemblyId: 123 }),
      }
    );

    const res = await PUT(req, makeParams("s1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "assemblyId must be a string or null",
    });
  });

  it("returns 404 when sample not found", async () => {
    mocks.getServerSession.mockResolvedValue(ownerSession);
    mocks.db.sample.findUnique.mockResolvedValue(null);
    const req = new NextRequest(
      "http://localhost/api/samples/s1/preferred-assembly",
      {
        method: "PUT",
        body: JSON.stringify({ assemblyId: "asm-1" }),
      }
    );

    const res = await PUT(req, makeParams("s1"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Sample not found" });
  });

  it("returns 403 when not owner and not admin", async () => {
    mocks.getServerSession.mockResolvedValue(otherSession);
    mocks.db.sample.findUnique.mockResolvedValue({
      ...baseSample,
      order: { userId: "user-1" },
      study: { id: "study-1", userId: "user-1" },
    });
    const req = new NextRequest(
      "http://localhost/api/samples/s1/preferred-assembly",
      {
        method: "PUT",
        body: JSON.stringify({ assemblyId: "asm-1" }),
      }
    );

    const res = await PUT(req, makeParams("s1"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  it("returns 400 when sample not in requested study", async () => {
    mocks.getServerSession.mockResolvedValue(ownerSession);
    mocks.db.sample.findUnique.mockResolvedValue(baseSample);
    const req = new NextRequest(
      "http://localhost/api/samples/s1/preferred-assembly",
      {
        method: "PUT",
        body: JSON.stringify({ assemblyId: "asm-1", studyId: "other-study" }),
      }
    );

    const res = await PUT(req, makeParams("s1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Sample is not assigned to the requested study",
    });
  });

  it("returns 400 when assembly not found for sample", async () => {
    mocks.getServerSession.mockResolvedValue(ownerSession);
    mocks.db.sample.findUnique.mockResolvedValue(baseSample);
    const req = new NextRequest(
      "http://localhost/api/samples/s1/preferred-assembly",
      {
        method: "PUT",
        body: JSON.stringify({ assemblyId: "nonexistent-asm" }),
      }
    );

    const res = await PUT(req, makeParams("s1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Assembly not found for this sample",
    });
  });

  it("returns 400 when assembly has no file path", async () => {
    mocks.getServerSession.mockResolvedValue(ownerSession);
    mocks.db.sample.findUnique.mockResolvedValue(baseSample);
    const req = new NextRequest(
      "http://localhost/api/samples/s1/preferred-assembly",
      {
        method: "PUT",
        body: JSON.stringify({ assemblyId: "asm-2" }),
      }
    );

    const res = await PUT(req, makeParams("s1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Cannot select an assembly without a file path",
    });
  });

  it("returns 200 on success setting assembly", async () => {
    mocks.getServerSession.mockResolvedValue(ownerSession);
    mocks.db.sample.findUnique.mockResolvedValue(baseSample);
    mocks.db.sample.update.mockResolvedValue({
      id: "s1",
      preferredAssemblyId: "asm-1",
    });
    const req = new NextRequest(
      "http://localhost/api/samples/s1/preferred-assembly",
      {
        method: "PUT",
        body: JSON.stringify({ assemblyId: "asm-1" }),
      }
    );

    const res = await PUT(req, makeParams("s1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.sampleId).toBe("s1");
    expect(data.preferredAssemblyId).toBe("asm-1");
    expect(data.preferredAssembly).toEqual(baseSample.assemblies[0]);
    expect(mocks.db.sample.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { preferredAssemblyId: "asm-1" },
      select: { id: true, preferredAssemblyId: true },
    });
  });

  it("returns 200 on success clearing assembly (null)", async () => {
    mocks.getServerSession.mockResolvedValue(ownerSession);
    mocks.db.sample.findUnique.mockResolvedValue(baseSample);
    mocks.db.sample.update.mockResolvedValue({
      id: "s1",
      preferredAssemblyId: null,
    });
    const req = new NextRequest(
      "http://localhost/api/samples/s1/preferred-assembly",
      {
        method: "PUT",
        body: JSON.stringify({ assemblyId: null }),
      }
    );

    const res = await PUT(req, makeParams("s1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.preferredAssemblyId).toBeNull();
    expect(data.preferredAssembly).toBeNull();
    expect(mocks.db.sample.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { preferredAssemblyId: null },
      select: { id: true, preferredAssemblyId: true },
    });
  });

  it("returns 200 for admin even if not owner", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.sample.findUnique.mockResolvedValue({
      ...baseSample,
      order: { userId: "someone-else" },
      study: { id: "study-1", userId: "someone-else" },
    });
    mocks.db.sample.update.mockResolvedValue({
      id: "s1",
      preferredAssemblyId: "asm-1",
    });
    const req = new NextRequest(
      "http://localhost/api/samples/s1/preferred-assembly",
      {
        method: "PUT",
        body: JSON.stringify({ assemblyId: "asm-1" }),
      }
    );

    const res = await PUT(req, makeParams("s1"));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it("returns 500 on database error", async () => {
    mocks.getServerSession.mockResolvedValue(ownerSession);
    mocks.db.sample.findUnique.mockRejectedValue(new Error("DB error"));
    const req = new NextRequest(
      "http://localhost/api/samples/s1/preferred-assembly",
      {
        method: "PUT",
        body: JSON.stringify({ assemblyId: "asm-1" }),
      }
    );

    const res = await PUT(req, makeParams("s1"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Failed to update preferred assembly",
    });
  });
});
