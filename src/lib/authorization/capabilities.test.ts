import { describe, expect, it } from "vitest";

import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";

import { getCapabilityGrant, hasCapability } from "./capabilities";
import type { AccountLevel, Capability, Principal } from "./types";

function principal(
  accountLevel: AccountLevel,
  facilityWorkflowRole: "requester" | "operator" = "requester"
): Principal {
  return {
    kind: "human",
    id: `${accountLevel}-1`,
    accountLevel,
    facilityWorkflowRole,
  };
}

describe("deployment profile capability grants", () => {
  it.each([
    ["sequencing-center", "member", "requester", "orders.create", true, "own"],
    ["sequencing-center", "member", "requester", "analysis.run", false, null],
    ["sequencing-center", "admin", "operator", "analysis.run", true, "installation"],
    ["shared-lab", "member", "requester", "analysis.run", true, "installation"],
    ["shared-lab", "member", "requester", "system.settings.manage", false, null],
    ["shared-lab", "admin", "operator", "system.settings.manage", true, "installation"],
    ["shared-lab", "member", "requester", "analysis.cancel_all", false, null],
    ["research-workbench", "member", "requester", "workbench.import", true, "workspace"],
    ["research-workbench", "admin", "operator", "system.pipelines.manage", true, "installation"],
    ["research-workbench", "admin", "operator", "analysis.read_all", false, null],
    ["research-workbench", "admin", "operator", "orders.read_all", false, null],
  ] as const)(
    "%s %s %s -> %s",
    (profileId, accountLevel, workflowRole, capability, allowed, scope) => {
      const profile = getDeploymentProfileDefinition(profileId);
      const actor = principal(accountLevel, workflowRole);
      const grant = getCapabilityGrant(profile, actor, capability as Capability);

      expect(hasCapability(profile, actor, capability as Capability)).toBe(allowed);
      expect(grant?.scope ?? null).toBe(scope);
    }
  );

  it("does not give a Workbench administrator access to private member data", () => {
    const profile = getDeploymentProfileDefinition("research-workbench");
    const administrator = principal("admin", "operator");

    expect(hasCapability(profile, administrator, "system.settings.manage")).toBe(true);
    expect(hasCapability(profile, administrator, "analysis.read_all")).toBe(false);
    expect(getCapabilityGrant(profile, administrator, "analysis.read_own")?.scope).toBe(
      "workspace"
    );
  });

  it("does not grant human capabilities to reserved service principals", () => {
    const profile = getDeploymentProfileDefinition("shared-lab");
    const service: Principal = {
      kind: "service",
      id: "worker-1",
      accountLevel: "admin",
    };

    expect(hasCapability(profile, service, "analysis.run")).toBe(false);
    expect(hasCapability(profile, service, "system.settings.manage")).toBe(false);
  });
});
