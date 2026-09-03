import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getServerDeploymentProfile: vi.fn(),
  db: { $transaction: vi.fn() },
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/deployment-profile/server", () => ({
  getServerDeploymentProfile: mocks.getServerDeploymentProfile,
}));

import { PATCH } from "./route";
import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";

const adminSession = {
  user: {
    id: "admin-1",
    systemRole: "ADMIN",
    role: "RESEARCHER",
    isDemo: false,
  },
};

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/users/user-1/role", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(id = "user-1") {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/admin/users/[id]/role", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("sequencing-center"),
    );
  });

  it("requires administrator access", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "member-1",
        systemRole: "MEMBER",
        role: "FACILITY_ADMIN",
      },
    });
    const response = await PATCH(request({ systemRole: "ADMIN" }), params());
    expect(response.status).toBe(403);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("promotes a member in a serializable transaction", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-1",
          role: "RESEARCHER",
          systemRole: "MEMBER",
          facilityWorkflowRole: "REQUESTER",
          isActive: true,
          email: "member@example.test",
        }),
        count: vi.fn(),
        update: vi.fn().mockResolvedValue({
          id: "user-1",
          role: "FACILITY_ADMIN",
          systemRole: "ADMIN",
          facilityWorkflowRole: "REQUESTER",
          isActive: true,
          email: "member@example.test",
        }),
      },
    };
    mocks.db.$transaction.mockImplementation(async (callback) => callback(tx));

    const response = await PATCH(request({ systemRole: "ADMIN" }), params());

    expect(response.status).toBe(200);
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          systemRole: "ADMIN",
          facilityWorkflowRole: "REQUESTER",
          role: "FACILITY_ADMIN",
        },
      })
    );
    expect(tx.user.count).not.toHaveBeenCalled();
    expect(mocks.db.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: "Serializable",
    });
  });

  it("prevents demotion of the final administrator atomically", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "admin-1",
          role: "FACILITY_ADMIN",
          systemRole: "ADMIN",
          facilityWorkflowRole: "OPERATOR",
          isActive: true,
          email: "admin@example.test",
        }),
        count: vi.fn().mockResolvedValue(1),
        update: vi.fn(),
      },
    };
    mocks.db.$transaction.mockImplementation(async (callback) => callback(tx));

    const response = await PATCH(
      request({ systemRole: "MEMBER" }),
      params("admin-1")
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "FINAL_ADMINISTRATOR",
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("allows demotion when another administrator exists", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "admin-2",
          role: "FACILITY_ADMIN",
          systemRole: "ADMIN",
          facilityWorkflowRole: "OPERATOR",
          isActive: true,
          email: "admin2@example.test",
        }),
        count: vi.fn().mockResolvedValue(2),
        update: vi.fn().mockResolvedValue({
          id: "admin-2",
          role: "RESEARCHER",
          systemRole: "MEMBER",
          facilityWorkflowRole: "OPERATOR",
          isActive: true,
          email: "admin2@example.test",
        }),
      },
      adminInvite: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    };
    mocks.db.$transaction.mockImplementation(async (callback) => callback(tx));

    const response = await PATCH(
      request({ systemRole: "MEMBER" }),
      params("admin-2")
    );

    expect(response.status).toBe(200);
    expect(tx.user.count).toHaveBeenCalledWith({
      where: { systemRole: "ADMIN", isActive: true },
    });
    expect(tx.user.update).toHaveBeenCalled();
    expect(tx.adminInvite.updateMany).toHaveBeenCalledWith({
      where: { createdById: "admin-2", usedAt: null, revokedAt: null },
      data: { revokedAt: expect.any(Date), revokedById: "admin-1" },
    });
  });

  it("keeps system and legacy roles in sync for older callers", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-1",
          role: "RESEARCHER",
          systemRole: "MEMBER",
          facilityWorkflowRole: "REQUESTER",
          isActive: true,
          email: "member@example.test",
        }),
        count: vi.fn(),
        update: vi.fn().mockResolvedValue({
          id: "user-1",
          role: "FACILITY_ADMIN",
          systemRole: "ADMIN",
          facilityWorkflowRole: "OPERATOR",
          isActive: true,
          email: "member@example.test",
        }),
      },
    };
    mocks.db.$transaction.mockImplementation(async (callback) => callback(tx));

    const response = await PATCH(request({ role: "FACILITY_ADMIN" }), params());

    expect(response.status).toBe(200);
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          systemRole: "ADMIN",
          facilityWorkflowRole: "OPERATOR",
          role: "FACILITY_ADMIN",
        },
      })
    );
  });

  it("rejects unknown system roles", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);

    const response = await PATCH(request({ systemRole: "OWNER" }), params());

    expect(response.status).toBe(400);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects contradictory legacy and system roles", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);

    const response = await PATCH(
      request({ role: "FACILITY_ADMIN", systemRole: "MEMBER" }),
      params()
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("conflict"),
    });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("stores member/operator access independently with a conservative legacy mirror", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-1",
          role: "RESEARCHER",
          systemRole: "MEMBER",
          facilityWorkflowRole: "REQUESTER",
          isActive: true,
          email: "member@example.test",
        }),
        count: vi.fn(),
        update: vi.fn().mockImplementation(async ({ data }) => ({
          id: "user-1",
          email: "member@example.test",
          isActive: true,
          ...data,
        })),
      },
    };
    mocks.db.$transaction.mockImplementation(async (callback) => callback(tx));

    const response = await PATCH(
      request({ systemRole: "MEMBER", facilityWorkflowRole: "OPERATOR" }),
      params()
    );

    expect(response.status).toBe(200);
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          systemRole: "MEMBER",
          facilityWorkflowRole: "OPERATOR",
          role: "RESEARCHER",
        },
      })
    );
  });

  it("rejects facility-operator access outside Sequencing Center", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("shared-lab"),
    );

    const response = await PATCH(
      request({ facilityWorkflowRole: "OPERATOR" }),
      params()
    );

    expect(response.status).toBe(400);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
});
