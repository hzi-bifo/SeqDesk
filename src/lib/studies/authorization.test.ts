import { describe, expect, it } from "vitest";

import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";

import {
  canAccessStudyOwner,
  canUseOperationalStudyFields,
  decideStudyMutationAccess,
  decideStudyReadAccess,
} from "./authorization";

const memberSession = {
  user: { id: "member-1", role: "RESEARCHER" },
} as const;
const adminSession = {
  user: { id: "admin-1", role: "FACILITY_ADMIN" },
} as const;

describe("study authorization", () => {
  it("keeps Sequencing Center researchers scoped to their own studies", () => {
    const profile = getDeploymentProfileDefinition("sequencing-center");
    const read = decideStudyReadAccess(memberSession, profile);
    const mutate = decideStudyMutationAccess(memberSession, profile);

    expect(read.grant?.scope).toBe("own");
    expect(mutate.grant?.scope).toBe("own");
    expect(canAccessStudyOwner(read, "member-1")).toBe(true);
    expect(canAccessStudyOwner(read, "member-2")).toBe(false);
    expect(canUseOperationalStudyFields(memberSession, profile)).toBe(false);
  });

  it("gives Shared Lab members installation-scoped scientific access", () => {
    const profile = getDeploymentProfileDefinition("shared-lab");
    const read = decideStudyReadAccess(memberSession, profile);
    const mutate = decideStudyMutationAccess(memberSession, profile);

    expect(read.grant?.scope).toBe("installation");
    expect(mutate.grant?.scope).toBe("installation");
    expect(canAccessStudyOwner(read, "member-2")).toBe(true);
    expect(canAccessStudyOwner(mutate, "member-2")).toBe(true);
    expect(canUseOperationalStudyFields(memberSession, profile)).toBe(true);
  });

  it("keeps Sequencing Center operators installation-scoped", () => {
    const profile = getDeploymentProfileDefinition("sequencing-center");

    expect(decideStudyReadAccess(adminSession, profile).grant?.scope).toBe(
      "installation"
    );
    expect(decideStudyMutationAccess(adminSession, profile).grant?.scope).toBe(
      "installation"
    );
    expect(canUseOperationalStudyFields(adminSession, profile)).toBe(true);
  });

  it("fails closed when the study domain is unavailable", () => {
    const profile = getDeploymentProfileDefinition("research-workbench");

    expect(decideStudyReadAccess(memberSession, profile)).toMatchObject({
      allowed: false,
      status: 404,
    });
    expect(decideStudyMutationAccess(memberSession, profile)).toMatchObject({
      allowed: false,
      status: 404,
    });
    expect(canUseOperationalStudyFields(memberSession, profile)).toBe(false);
  });
});
