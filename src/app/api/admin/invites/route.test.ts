import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getServerDeploymentProfile: vi.fn(),
  db: {
    user: { findUnique: vi.fn() },
    adminInvite: { findMany: vi.fn(), create: vi.fn() },
  },
  randomBytes: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/deployment-profile/server", () => ({
  getServerDeploymentProfile: mocks.getServerDeploymentProfile,
}));
vi.mock("crypto", () => ({ randomBytes: mocks.randomBytes }));
vi.mock("@prisma/client", () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message: string, { code }: { code: string }) {
        super(message);
        this.code = code;
      }
    },
  },
}));

import { GET, POST } from "./route";
import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";

const adminSession = {
  user: {
    id: "admin-1",
    role: "FACILITY_ADMIN",
    systemRole: "ADMIN",
    facilityWorkflowRole: "REQUESTER",
  },
};

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/admin/invites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin invitations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("sequencing-center"),
    );
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.user.findUnique.mockResolvedValue({
      id: "admin-1",
      systemRole: "ADMIN",
      isActive: true,
    });
    mocks.randomBytes.mockReturnValue({
      toString: () => "a".repeat(48),
    });
    mocks.db.adminInvite.create.mockImplementation(async ({ data }) => ({
      id: "invite-1",
      ...data,
      createdBy: { firstName: "Admin", lastName: "User" },
    }));
  });

  it("requires administrator access", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await POST(request({}))).status).toBe(401);

    mocks.getServerSession.mockResolvedValue({
      user: { id: "member-1", role: "RESEARCHER", systemRole: "MEMBER" },
    });
    expect((await GET()).status).toBe(403);
  });

  it("lists explicit stored invitation grants", async () => {
    mocks.db.adminInvite.findMany.mockResolvedValue([
      {
        id: "invite-1",
        code: `M-${"A".repeat(48)}`,
        targetSystemRole: "MEMBER",
        targetFacilityWorkflowRole: "OPERATOR",
        createdBy: { firstName: "Admin", lastName: "User" },
        usedBy: null,
      },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject([
      {
        grant: {
          systemRole: "MEMBER",
          facilityWorkflowRole: "OPERATOR",
        },
      },
    ]);
  });

  it("defaults to a safe unrestricted member/requester invitation", async () => {
    const response = await POST(request({}));

    expect(response.status).toBe(201);
    expect(mocks.randomBytes).toHaveBeenCalledWith(24);
    expect(mocks.db.adminInvite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: `M-${"A".repeat(48)}`,
          email: null,
          targetSystemRole: "MEMBER",
          targetFacilityWorkflowRole: "REQUESTER",
        }),
      })
    );
  });

  it("creates an email-bound administrator who can remain a requester", async () => {
    const response = await POST(
      request({
        email: "  Admin@Example.COM ",
        systemRole: "ADMIN",
        facilityWorkflowRole: "REQUESTER",
      })
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      code: `A-${"A".repeat(48)}`,
      email: "admin@example.com",
      grant: {
        systemRole: "ADMIN",
        facilityWorkflowRole: "REQUESTER",
      },
    });
  });

  it("creates a member who is independently a facility operator", async () => {
    const response = await POST(
      request({ systemRole: "MEMBER", facilityWorkflowRole: "OPERATOR" })
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      grant: {
        systemRole: "MEMBER",
        facilityWorkflowRole: "OPERATOR",
      },
      accountRole: "RESEARCHER",
    });
  });

  it("requires every administrator invitation to be email-bound", async () => {
    const response = await POST(request({ systemRole: "ADMIN" }));

    expect(response.status).toBe(400);
    expect(mocks.db.adminInvite.create).not.toHaveBeenCalled();
  });

  it("rejects invalid and contradictory input strictly", async () => {
    const invalidEmail = await POST(request({ email: "not-an-email" }));
    const extraField = await POST(request({ unknownGrant: "ADMIN" }));
    const contradictory = await POST(
      request({ accountRole: "FACILITY_ADMIN", systemRole: "MEMBER" })
    );

    expect(invalidEmail.status).toBe(400);
    expect(extraField.status).toBe(400);
    expect(contradictory.status).toBe(400);
    expect(mocks.db.adminInvite.create).not.toHaveBeenCalled();
  });

  it("rejects operator grants outside Sequencing Center", async () => {
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("shared-lab"),
    );

    const response = await POST(
      request({ facilityWorkflowRole: "OPERATOR" })
    );

    expect(response.status).toBe(400);
    expect(mocks.db.adminInvite.create).not.toHaveBeenCalled();
  });

  it("rechecks that the invitation creator is still an active administrator", async () => {
    mocks.db.user.findUnique.mockResolvedValue({
      id: "admin-1",
      systemRole: "ADMIN",
      isActive: false,
    });

    const response = await POST(request({}));

    expect(response.status).toBe(403);
    expect(mocks.db.adminInvite.create).not.toHaveBeenCalled();
  });
});
