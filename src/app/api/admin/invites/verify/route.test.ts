import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  db: { adminInvite: { findFirst: vi.fn() } },
  getServerDeploymentProfile: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/deployment-profile/server", () => ({
  getServerDeploymentProfile: mocks.getServerDeploymentProfile,
}));

import { POST } from "./route";
import { inviteCodeLookup } from "@/lib/accounts/invite-secret.server";

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/invites/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function activeInvite(overrides: Record<string, unknown> = {}) {
  return {
    code: "M-ABC123",
    email: "private@example.com",
    usedAt: null,
    revokedAt: null,
    expiresAt: new Date("2099-01-01"),
    targetSystemRole: "MEMBER",
    targetFacilityWorkflowRole: "REQUESTER",
    createdBy: { systemRole: "ADMIN", isActive: true },
    ...overrides,
  };
}

describe("POST /api/admin/invites/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerDeploymentProfile.mockReturnValue({ id: "sequencing-center" });
  });

  it("uses one generic error shape for malformed, missing, used, expired, revoked, or creator-invalid invitations", async () => {
    const expected = {
      valid: false,
      error: "This invitation is invalid or no longer active",
    };

    const malformed = await POST(request({}));

    mocks.db.adminInvite.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeInvite({ usedAt: new Date() }))
      .mockResolvedValueOnce(activeInvite({ expiresAt: new Date("2020-01-01") }))
      .mockResolvedValueOnce(activeInvite({ revokedAt: new Date() }))
      .mockResolvedValueOnce(
        activeInvite({ createdBy: { systemRole: "ADMIN", isActive: false } })
      )
      .mockResolvedValueOnce(
        activeInvite({ createdBy: { systemRole: "MEMBER", isActive: true } })
      );

    const responses = [
      malformed,
      await POST(request({ code: "missing" })),
      await POST(request({ code: "used" })),
      await POST(request({ code: "expired" })),
      await POST(request({ code: "revoked" })),
      await POST(request({ code: "inactive-creator" })),
      await POST(request({ code: "demoted-creator" })),
    ];

    for (const response of responses) {
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual(expected);
    }
  });

  it("returns only the explicit grant needed by registration", async () => {
    mocks.db.adminInvite.findFirst.mockResolvedValue(
      activeInvite({
        targetSystemRole: "ADMIN",
        targetFacilityWorkflowRole: "REQUESTER",
      })
    );

    const response = await POST(request({ code: "m-abc123" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      valid: true,
      grant: {
        systemRole: "ADMIN",
        facilityWorkflowRole: "REQUESTER",
      },
    });
    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("accountRole");
    expect(mocks.db.adminInvite.findFirst).toHaveBeenCalledWith({
      where: inviteCodeLookup("M-ABC123").where,
      include: {
        createdBy: { select: { systemRole: true, isActive: true } },
      },
    });
  });

  it("does not expose a stale operator grant outside Sequencing Center", async () => {
    mocks.getServerDeploymentProfile.mockReturnValue({ id: "shared-lab" });
    mocks.db.adminInvite.findFirst.mockResolvedValue(
      activeInvite({ targetFacilityWorkflowRole: "OPERATOR" })
    );

    const response = await POST(request({ code: "M-ABC123" }));

    await expect(response.json()).resolves.toMatchObject({
      grant: { facilityWorkflowRole: "REQUESTER" },
    });
  });

  it("returns 500 on an unexpected database failure", async () => {
    mocks.db.adminInvite.findFirst.mockRejectedValue(new Error("DB error"));

    const response = await POST(request({ code: "M-ABC123" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      valid: false,
      error: "Failed to verify invite",
    });
  });
});
