import { describe, expect, it } from "vitest";

import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";

import { AuthorizationError, decideCapability, requireCapability } from "./guards";

describe("capability guards", () => {
  const sharedLab = getDeploymentProfileDefinition("shared-lab");
  const workbench = getDeploymentProfileDefinition("research-workbench");

  it("returns 401 for an unauthenticated request", () => {
    expect(decideCapability(null, "analysis.run", sharedLab)).toMatchObject({
      allowed: false,
      status: 401,
      reason: "unauthenticated",
    });
  });

  it("returns 401 for a session invalidated after account removal", () => {
    expect(
      decideCapability(
        {
          user: {
            id: "removed-admin",
            role: "FACILITY_ADMIN",
            authorizationValid: false,
          },
        },
        "system.settings.manage",
        sharedLab
      )
    ).toMatchObject({
      allowed: false,
      status: 401,
      reason: "unauthenticated",
    });
  });

  it("fails closed for an unknown stored role", () => {
    expect(
      decideCapability(
        { user: { id: "user-1", role: "UNRECOGNIZED" } },
        "analysis.run",
        sharedLab
      )
    ).toMatchObject({
      allowed: false,
      status: 401,
      reason: "unauthenticated",
    });
  });

  it("returns 404 when the active profile does not include the domain", () => {
    expect(
      decideCapability(
        { user: { id: "member-1", role: "RESEARCHER" } },
        "orders.read",
        { ...workbench, domains: workbench.domains.filter(d => d !== "facility-intake") }
      )
    ).toMatchObject({
      allowed: false,
      status: 404,
      reason: "domain-unavailable",
    });
  });

  it("returns 403 when the domain exists but the account lacks permission", () => {
    expect(
      decideCapability(
        { user: { id: "member-1", role: "RESEARCHER" } },
        "system.settings.manage",
        sharedLab
      )
    ).toMatchObject({
      allowed: false,
      status: 403,
      reason: "forbidden",
    });
  });

  it("maps the legacy admin role through the compatibility adapter", () => {
    expect(
      requireCapability(
        { user: { id: "admin-1", role: "FACILITY_ADMIN" } },
        "system.users.manage",
        sharedLab
      )
    ).toMatchObject({ scope: "installation" });
  });

  it("throws a typed error for denied access", () => {
    expect(() =>
      requireCapability(
        { user: { id: "member-1", role: "RESEARCHER" } },
        "system.users.manage",
        sharedLab
      )
    ).toThrow(AuthorizationError);
  });
});
