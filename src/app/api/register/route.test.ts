import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  hash: vi.fn(),
  getServerEnrollmentPolicy: vi.fn(),
  getServerDeploymentProfile: vi.fn(),
  transactionUserCreate: vi.fn(),
  transactionInviteUpdateMany: vi.fn(),
  db: {
    siteSettings: { findUnique: vi.fn() },
    user: { count: vi.fn(), findFirst: vi.fn() },
    department: { findUnique: vi.fn() },
    adminInvite: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("bcryptjs", () => ({ hash: mocks.hash }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/deployment-profile/enrollment.server", () => ({
  getServerEnrollmentPolicy: mocks.getServerEnrollmentPolicy,
}));
vi.mock("@/lib/deployment-profile/server", () => ({
  getServerDeploymentProfile: mocks.getServerDeploymentProfile,
}));
vi.mock("@/lib/modules/types", () => ({
  DEFAULT_MODULE_STATES: {},
  DEFAULT_ACCOUNT_VALIDATION_SETTINGS: {
    allowedDomains: [],
    enforceValidation: false,
  },
}));

import { POST } from "./route";
import { inviteCodeLookup } from "@/lib/accounts/invite-secret.server";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  email: "new@example.com",
  password: "securepassword",
  firstName: "Jane",
  lastName: "Doe",
};

function activeInvite(overrides: Record<string, unknown> = {}) {
  return {
    id: "invite-1",
    code: "M-MEMBER01",
    email: null,
    usedAt: null,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    targetSystemRole: "MEMBER",
    targetFacilityWorkflowRole: "REQUESTER",
    createdBy: { systemRole: "ADMIN", isActive: true },
    ...overrides,
  };
}

describe("POST /api/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hash.mockResolvedValue("hashed-pw");
    mocks.getServerDeploymentProfile.mockReturnValue({ id: "sequencing-center" });
    mocks.getServerEnrollmentPolicy.mockResolvedValue({
      policy: "self-registration",
      allowSelfRegistration: true,
      source: "profile-default",
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    mocks.db.user.count.mockResolvedValue(1);
    mocks.db.user.findFirst.mockResolvedValue(null);
    mocks.transactionInviteUpdateMany.mockResolvedValue({ count: 1 });
    mocks.transactionUserCreate.mockImplementation(async ({ data }) => ({
      id: "user-1",
      ...data,
    }));
    mocks.db.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          user: { create: mocks.transactionUserCreate },
          adminInvite: { updateMany: mocks.transactionInviteUpdateMany },
        })
    );
  });

  it("creates a lowercase member account with safe default grants", async () => {
    const response = await POST(
      makeRequest({ ...validBody, email: "  New@Example.COM " })
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      user: {
        email: "new@example.com",
        systemRole: "MEMBER",
        facilityWorkflowRole: "REQUESTER",
        role: "RESEARCHER",
      },
    });
    expect(mocks.db.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: "new@example.com", mode: "insensitive" },
      },
    });
    expect(mocks.transactionUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "new@example.com",
          systemRole: "MEMBER",
          facilityWorkflowRole: "REQUESTER",
          role: "RESEARCHER",
        }),
      })
    );
    expect(mocks.hash).toHaveBeenCalledWith("securepassword", 12);
  });

  it("rejects missing fields and client-supplied system access", async () => {
    const missing = await POST(makeRequest({ email: "a@b.com" }));
    const elevated = await POST(
      makeRequest({ ...validBody, systemRole: "ADMIN" })
    );

    expect(missing.status).toBe(400);
    expect(elevated.status).toBe(400);
    await expect(missing.json()).resolves.toEqual({
      error: "Invalid registration details",
    });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects passwords whose UTF-8 representation exceeds bcrypt's 72-byte limit", async () => {
    const response = await POST(
      makeRequest({ ...validBody, password: "🔬".repeat(19) })
    );

    expect(response.status).toBe(400);
    expect(mocks.hash).not.toHaveBeenCalled();
  });

  it("rejects an existing address case-insensitively", async () => {
    mocks.db.user.findFirst.mockResolvedValue({ id: "existing" });

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "User with this email already exists",
    });
  });

  it("does not open registration before setup has an active administrator", async () => {
    mocks.db.user.count.mockResolvedValue(0);

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "SETUP_INCOMPLETE",
    });
  });

  it("requires an invitation when enrollment is invite-only", async () => {
    mocks.getServerEnrollmentPolicy.mockResolvedValue({
      policy: "invite-only",
      allowSelfRegistration: false,
      source: "profile-default",
    });

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVITE_REQUIRED",
    });
    expect(mocks.hash).not.toHaveBeenCalled();
  });

  it("redeems a member invite through an atomic conditional claim", async () => {
    mocks.db.adminInvite.findFirst.mockResolvedValue(
      activeInvite({ email: "new@example.com" })
    );

    const response = await POST(
      makeRequest({ ...validBody, inviteCode: "m-member01" })
    );

    expect(response.status).toBe(201);
    expect(mocks.db.adminInvite.findFirst).toHaveBeenCalledWith({
      where: inviteCodeLookup("M-MEMBER01").where,
      include: {
        createdBy: { select: { systemRole: true, isActive: true } },
      },
    });
    expect(mocks.transactionInviteUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "invite-1",
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
        createdBy: {
          is: { systemRole: "ADMIN", isActive: true },
        },
      },
      data: { usedAt: expect.any(Date), usedById: "user-1", code: null },
    });
  });

  it("supports a member who is independently a Sequencing Center operator", async () => {
    mocks.db.adminInvite.findFirst.mockResolvedValue(
      activeInvite({ targetFacilityWorkflowRole: "OPERATOR" })
    );

    const response = await POST(
      makeRequest({ ...validBody, inviteCode: "m-member01" })
    );

    expect(response.status).toBe(201);
    expect(mocks.transactionUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          systemRole: "MEMBER",
          facilityWorkflowRole: "OPERATOR",
          role: "RESEARCHER",
        }),
      })
    );
  });

  it("redeems a digest-only invitation using its explicit stored grant", async () => {
    mocks.db.adminInvite.findFirst.mockResolvedValue(activeInvite({
      code: null,
      codeDigest: inviteCodeLookup("M-MEMBER01").codeDigest,
    }));
    const response = await POST(makeRequest({ ...validBody, inviteCode: "m-member01" }));
    expect(response.status).toBe(201);
    expect(mocks.transactionUserCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ systemRole: "MEMBER" }),
    }));
  });

  it("supports an administrator who remains a Sequencing Center requester", async () => {
    mocks.db.adminInvite.findFirst.mockResolvedValue(
      activeInvite({
        code: "A-ADMIN01",
        email: "new@example.com",
        targetSystemRole: "ADMIN",
        targetFacilityWorkflowRole: "REQUESTER",
      })
    );

    const response = await POST(
      makeRequest({ ...validBody, inviteCode: "a-admin01" })
    );

    expect(response.status).toBe(201);
    expect(mocks.transactionUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          systemRole: "ADMIN",
          facilityWorkflowRole: "REQUESTER",
          role: "FACILITY_ADMIN",
        }),
      })
    );
  });

  it("never lets a legacy role assertion elevate a member grant", async () => {
    mocks.db.adminInvite.findFirst.mockResolvedValue(activeInvite());

    const response = await POST(
      makeRequest({
        ...validBody,
        inviteCode: "M-MEMBER01",
        role: "FACILITY_ADMIN",
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.transactionUserCreate).not.toHaveBeenCalled();
  });

  it("rejects revoked invitations and invitations from inactive creators", async () => {
    mocks.db.adminInvite.findFirst
      .mockResolvedValueOnce(activeInvite({ revokedAt: new Date() }))
      .mockResolvedValueOnce(
        activeInvite({ createdBy: { systemRole: "ADMIN", isActive: false } })
      );

    const revoked = await POST(
      makeRequest({ ...validBody, inviteCode: "M-MEMBER01" })
    );
    const inactiveCreator = await POST(
      makeRequest({ ...validBody, inviteCode: "M-MEMBER01" })
    );

    expect(revoked.status).toBe(400);
    expect(inactiveCreator.status).toBe(400);
    expect(mocks.hash).not.toHaveBeenCalled();
  });

  it("enforces email-bound invitations", async () => {
    mocks.db.adminInvite.findFirst.mockResolvedValue(
      activeInvite({ email: "specific@example.com" })
    );

    const response = await POST(
      makeRequest({
        ...validBody,
        email: "other@example.com",
        inviteCode: "M-MEMBER01",
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.transactionUserCreate).not.toHaveBeenCalled();
  });

  it("rolls back registration when another request claims the invite first", async () => {
    mocks.db.adminInvite.findFirst.mockResolvedValue(activeInvite());
    mocks.transactionInviteUpdateMany.mockResolvedValue({ count: 0 });

    const response = await POST(
      makeRequest({ ...validBody, inviteCode: "M-MEMBER01" })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "This invite was already used or revoked",
    });
  });

  it("normalizes legacy operator grants and rejects center-only fields outside the center", async () => {
    mocks.getServerDeploymentProfile.mockReturnValue({ id: "shared-lab" });
    mocks.db.adminInvite.findFirst.mockResolvedValue(
      activeInvite({ targetFacilityWorkflowRole: "OPERATOR" })
    );

    const accepted = await POST(
      makeRequest({ ...validBody, inviteCode: "M-MEMBER01" })
    );
    const rejected = await POST(
      makeRequest({ ...validBody, facilityName: "Legacy core" })
    );

    expect(accepted.status).toBe(201);
    expect(mocks.transactionUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ facilityWorkflowRole: "REQUESTER" }),
      })
    );
    expect(rejected.status).toBe(400);
  });

  it("validates Sequencing Center departments", async () => {
    mocks.db.department.findUnique.mockResolvedValue({
      id: "dept-1",
      isActive: false,
    });

    const response = await POST(
      makeRequest({ ...validBody, departmentId: "dept-1" })
    );

    expect(response.status).toBe(400);
    expect(mocks.transactionUserCreate).not.toHaveBeenCalled();
  });
});
