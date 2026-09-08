import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerDeploymentProfile: vi.fn(),
}));

vi.mock("@/lib/deployment-profile/server", () => ({
  getServerDeploymentProfile: mocks.getServerDeploymentProfile,
}));

import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";

import {
  authorizationErrorResponse,
  decideServerCapability,
} from "./api";

const memberSession = {
  user: { id: "member-1", role: "RESEARCHER" },
} as const;
const adminSession = {
  user: { id: "admin-1", role: "FACILITY_ADMIN" },
} as const;

describe("server capability API helpers", () => {
  beforeEach(() => {
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("shared-lab")
    );
  });

  it("allows Shared Lab administrators to manage settings", () => {
    expect(
      decideServerCapability(adminSession, "system.settings.manage")
    ).toMatchObject({ allowed: true, status: 200 });
  });

  it("returns a forbidden response for authenticated Shared Lab members", async () => {
    const decision = decideServerCapability(
      memberSession,
      "system.settings.manage"
    );
    const response = authorizationErrorResponse(decision);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  it("returns an unavailable response for a disabled capability domain", async () => {
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("research-workbench")
    );
    const decision = decideServerCapability(
      adminSession,
      "sequencing.runs.manage"
    );
    const response = authorizationErrorResponse(decision);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  it("allows administrators to configure sequencing in the shared application", async () => {
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("research-workbench")
    );
    const decision = decideServerCapability(
      adminSession,
      "system.sequencing.manage"
    );

    expect(decision).toMatchObject({
      allowed: true,
      status: 200,
      reason: "allowed",
    });
  });

  it("keeps the facility support desk unavailable outside Sequencing Center", async () => {
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("research-workbench")
    );

    const response = authorizationErrorResponse(
      decideServerCapability(adminSession, "support.tickets.manage")
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });
});
