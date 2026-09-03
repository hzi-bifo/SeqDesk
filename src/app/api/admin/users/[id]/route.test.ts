import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: { $transaction: vi.fn() },
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));

import { DELETE } from "./route";

const adminSession = {
  user: {
    id: "admin-1",
    systemRole: "ADMIN",
    role: "RESEARCHER",
    isDemo: false,
  },
};

const emptyCounts = {
  createdInvites: 0,
  orders: 0,
  orderNotesEdited: 0,
  sequencingFilesPublishedOrders: 0,
  statusNotes: 0,
  studies: 0,
  studyNotesEdited: 0,
  tickets: 0,
  ticketMessages: 0,
  pipelineRuns: 0,
  pipelineResultSelectionsSelected: 0,
  sequencingArtifactsCreated: 0,
  sequencingUploadsCreated: 0,
  backgroundWorkersStarted: 0,
  workbenchImportJobsCreated: 0,
};

function target(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "member@example.test",
    systemRole: "MEMBER",
    isActive: false,
    demoWorkspace: null,
    adminDemoWorkspace: null,
    usedInvite: null,
    workbenchWorkspace: null,
    _count: { ...emptyCounts },
    ...overrides,
  };
}

function request(confirmationEmail: unknown = "member@example.test") {
  return new NextRequest("http://localhost/api/admin/users/user-1", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmationEmail }),
  });
}

function params(id = "user-1") {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/admin/users/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires administrator access", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await DELETE(request(), params());

    expect(response.status).toBe(401);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("permanently deletes only a confirmed inactive empty account", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue(target()),
        count: vi.fn(),
        delete: vi.fn().mockResolvedValue({ id: "user-1" }),
      },
    };
    mocks.db.$transaction.mockImplementation(async (callback) => callback(tx));

    const response = await DELETE(request(" MEMBER@EXAMPLE.TEST "), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deleted: true,
      id: "user-1",
    });
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: "user-1" } });
    expect(mocks.db.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: "Serializable",
    });
  });

  it("requires deactivation before hard deletion", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue(target({ isActive: true })),
        count: vi.fn(),
        delete: vi.fn(),
      },
    };
    mocks.db.$transaction.mockImplementation(async (callback) => callback(tx));

    const response = await DELETE(request(), params());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "ACCOUNT_ACTIVE" });
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it("prevents deletion of the final active administrator", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue(
          target({
            id: "admin-1",
            email: "admin@example.test",
            systemRole: "ADMIN",
            isActive: true,
          })
        ),
        count: vi.fn().mockResolvedValue(1),
        delete: vi.fn(),
      },
    };
    mocks.db.$transaction.mockImplementation(async (callback) => callback(tx));

    const response = await DELETE(
      request("admin@example.test"),
      params("admin-1")
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "FINAL_ADMINISTRATOR",
    });
    expect(tx.user.count).toHaveBeenCalledWith({
      where: { systemRole: "ADMIN", isActive: true },
    });
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it("preserves accounts with scientific or workspace records", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const tx = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue(target({ workbenchWorkspace: { id: "workspace-1" } })),
        count: vi.fn(),
        delete: vi.fn(),
      },
    };
    mocks.db.$transaction.mockImplementation(async (callback) => callback(tx));

    const response = await DELETE(request(), params());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACCOUNT_HAS_RETAINED_DATA",
    });
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it("preserves scientific records owned by an inactive account", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue(
          target({ _count: { ...emptyCounts, orders: 1 } })
        ),
        count: vi.fn(),
        delete: vi.fn(),
      },
    };
    mocks.db.$transaction.mockImplementation(async (callback) => callback(tx));

    const response = await DELETE(request(), params());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACCOUNT_HAS_RETAINED_DATA",
    });
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it("requires an exact email confirmation", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue(target()),
        count: vi.fn(),
        delete: vi.fn(),
      },
    };
    mocks.db.$transaction.mockImplementation(async (callback) => callback(tx));

    const response = await DELETE(request("someone-else@example.test"), params());

    expect(response.status).toBe(400);
    expect(tx.user.delete).not.toHaveBeenCalled();
  });
});
