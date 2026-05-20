import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  isDemoSession: vi.fn(),
  db: {
    pipelineRun: {
      findUnique: vi.fn(),
    },
    pipelineResultSelection: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
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

vi.mock("@/lib/demo/server", () => ({
  isDemoSession: mocks.isDemoSession,
}));

import { DELETE, PUT } from "./route";

function request(method: string) {
  return new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/selection", {
    method,
  });
}

const params = { params: Promise.resolve({ id: "run-1" }) };

describe("/api/pipelines/runs/[id]/selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.isDemoSession.mockReturnValue(false);
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      pipelineId: "metaxpath",
      status: "completed",
      targetType: "study",
      studyId: "study-1",
      orderId: null,
    });
    mocks.db.pipelineResultSelection.upsert.mockResolvedValue({
      id: "selection-1",
      pipelineId: "metaxpath",
      targetKey: "study:study-1",
      selectedRunId: "run-1",
      selectedBy: { id: "admin-1", firstName: "Ada", lastName: "Admin", email: "a@example.org" },
    });
    mocks.db.pipelineResultSelection.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("rejects non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const response = await PUT(request("PUT"), params);

    expect(response.status).toBe(403);
    expect(mocks.db.pipelineResultSelection.upsert).not.toHaveBeenCalled();
  });

  it("selects a completed study run as the final result", async () => {
    const response = await PUT(request("PUT"), params);

    expect(response.status).toBe(200);
    expect(mocks.db.pipelineResultSelection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          pipelineId_targetKey: {
            pipelineId: "metaxpath",
            targetKey: "study:study-1",
          },
        },
        create: expect.objectContaining({
          pipelineId: "metaxpath",
          targetKey: "study:study-1",
          studyId: "study-1",
          orderId: null,
          selectedRunId: "run-1",
          selectedById: "admin-1",
        }),
        update: expect.objectContaining({
          selectedRunId: "run-1",
          selectedById: "admin-1",
        }),
      })
    );
  });

  it("rejects non-completed runs", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      pipelineId: "metaxpath",
      status: "failed",
      targetType: "study",
      studyId: "study-1",
      orderId: null,
    });

    const response = await PUT(request("PUT"), params);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Only completed pipeline runs can be selected as final.",
    });
  });

  it("clears the selection only when this run is selected", async () => {
    const response = await DELETE(request("DELETE"), params);

    expect(response.status).toBe(200);
    expect(mocks.db.pipelineResultSelection.deleteMany).toHaveBeenCalledWith({
      where: {
        pipelineId: "metaxpath",
        targetKey: "study:study-1",
        selectedRunId: "run-1",
      },
    });
    expect(await response.json()).toEqual({ success: true, cleared: true });
  });
});
