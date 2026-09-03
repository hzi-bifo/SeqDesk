import { describe, expect, it } from "vitest";

import {
  formatInviteCode,
  getInviteAccountRole,
  isInviteAccountRole,
} from "./invite-role";

describe("invite account roles", () => {
  it("creates visibly distinct member and administrator codes", () => {
    expect(formatInviteCode("abcd1234", "RESEARCHER")).toBe("M-ABCD1234");
    expect(formatInviteCode("abcd1234", "FACILITY_ADMIN")).toBe("A-ABCD1234");
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
  });
});
