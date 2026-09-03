import { describe, expect, it } from "vitest";

import {
  formatInviteCode,
  getInviteGrant,
  getInviteAccountRole,
  grantFromLegacyAccountRole,
  isFacilityWorkflowRole,
  isInviteAccountRole,
  isSystemRole,
  legacyRoleForSystemRole,
} from "./invite-role";

describe("invite account roles", () => {
  it("creates visibly distinct member and administrator codes", () => {
    expect(formatInviteCode("abcd1234", "MEMBER")).toBe("M-ABCD1234");
    expect(formatInviteCode("abcd1234", "ADMIN")).toBe("A-ABCD1234");
  });

  it("keeps legacy unprefixed invitations administrator-only", () => {
    expect(getInviteAccountRole("ABCD1234")).toBe("FACILITY_ADMIN");
    expect(getInviteAccountRole("A-ABCD1234")).toBe("FACILITY_ADMIN");
    expect(getInviteAccountRole("M-ABCD1234")).toBe("RESEARCHER");
  });

  it("validates supported target roles", () => {
    expect(isInviteAccountRole("RESEARCHER")).toBe(true);
    expect(isInviteAccountRole("FACILITY_ADMIN")).toBe(true);
    expect(isInviteAccountRole("OWNER")).toBe(false);
    expect(isSystemRole("ADMIN")).toBe(true);
    expect(isSystemRole("OWNER")).toBe(false);
    expect(isFacilityWorkflowRole("OPERATOR")).toBe(true);
    expect(isFacilityWorkflowRole("ADMIN")).toBe(false);
  });

  it("uses explicit independent grants before legacy prefixes", () => {
    expect(
      getInviteGrant({
        code: "A-LEGACYLOOKING",
        targetSystemRole: "MEMBER",
        targetFacilityWorkflowRole: "OPERATOR",
      })
    ).toEqual({ systemRole: "MEMBER", facilityWorkflowRole: "OPERATOR" });
    expect(
      getInviteGrant({
        code: "M-LEGACYLOOKING",
        targetSystemRole: "ADMIN",
        targetFacilityWorkflowRole: "REQUESTER",
      })
    ).toEqual({ systemRole: "ADMIN", facilityWorkflowRole: "REQUESTER" });
  });

  it("maps compatibility roles while keeping the two new dimensions separate", () => {
    expect(grantFromLegacyAccountRole("FACILITY_ADMIN")).toEqual({
      systemRole: "ADMIN",
      facilityWorkflowRole: "OPERATOR",
    });
    expect(legacyRoleForSystemRole("MEMBER")).toBe("RESEARCHER");
    expect(legacyRoleForSystemRole("ADMIN")).toBe("FACILITY_ADMIN");
  });
});
