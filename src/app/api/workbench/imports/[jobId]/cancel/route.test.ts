import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getOrCreateDefaultWorkbenchWorkspace: vi.fn(),
  serializeWorkbenchImportJob: vi.fn((job) => ({ id: job.id, status: job.status })),
  db: {
    workbenchImportJob: {
      findFirst: vi.fn(),
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

vi.mock("@/lib/workbench/workspaces", () => ({
  getOrCreateDefaultWorkbenchWorkspace: mocks.getOrCreateDefaultWorkbenchWorkspace,
  serializeWorkbenchImportJob: mocks.serializeWorkbenchImportJob,
}));

import { POST } from "./route";

function params(jobId = "job-a") {
  return { params: Promise.resolve({ jobId }) };
}

describe("POST /api/workbench/imports/[jobId]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.getOrCreateDefaultWorkbenchWorkspace.mockResolvedValue({
      id: "workspace-a",
      ownerId: "user-a",
    });
  });

  it("rejects unauthenticated users", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST(new Request("http://localhost"), params());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("does not expose another workspace's job", async () => {
    mocks.db.workbenchImportJob.findFirst.mockResolvedValue(null);

    const response = await POST(new Request("http://localhost"), params("job-b"));

    expect(mocks.db.workbenchImportJob.findFirst).toHaveBeenCalledWith({
      where: { id: "job-b", workspaceId: "workspace-a" },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Import job not found" });
  });

  it("only cancels queued jobs in the current workspace", async () => {
    mocks.db.workbenchImportJob.findFirst.mockResolvedValue({
      id: "job-a",
      workspaceId: "workspace-a",
      status: "queued",
    });
    mocks.db.workbenchImportJob.update.mockResolvedValue({
      id: "job-a",
      status: "cancelled",
    });

    const response = await POST(new Request("http://localhost"), params("job-a"));

    expect(response.status).toBe(200);
    expect(mocks.db.workbenchImportJob.update).toHaveBeenCalledWith({
      where: { id: "job-a" },
      data: expect.objectContaining({
        status: "cancelled",
        phase: "cancelled",
        progress: 0,
        finishedAt: expect.any(Date),
      }),
    });
    expect(await response.json()).toEqual({
      success: true,
      job: { id: "job-a", status: "cancelled" },
    });
  });

  it("rejects cancellation after a job has started", async () => {
    mocks.db.workbenchImportJob.findFirst.mockResolvedValue({
      id: "job-a",
      workspaceId: "workspace-a",
      status: "running",
    });

    const response = await POST(new Request("http://localhost"), params("job-a"));

    expect(response.status).toBe(409);
    expect(mocks.db.workbenchImportJob.update).not.toHaveBeenCalled();
  });
});
