import { describe, expect, it } from "vitest";

import { principalFromSession } from "./principal";

describe("principalFromSession", () => {
  it("uses the explicit system role independently from facility workflow role", () => {
    expect(
      principalFromSession({
        user: {
          id: "admin-requester",
          systemRole: "ADMIN",
          role: "RESEARCHER",
        },
      })
    ).toMatchObject({
      accountLevel: "admin",
      facilityWorkflowRole: "requester",
    });

    expect(
      principalFromSession({
        user: {
          id: "member-operator",
          systemRole: "MEMBER",
          role: "FACILITY_ADMIN",
        },
      })
    ).toMatchObject({
      accountLevel: "member",
      facilityWorkflowRole: "operator",
    });
  });

  it("maps legacy roles while older sessions are still supported", () => {
    expect(
      principalFromSession({ user: { id: "legacy-admin", role: "FACILITY_ADMIN" } })
    ).toMatchObject({ accountLevel: "admin", facilityWorkflowRole: "operator" });
    expect(
      principalFromSession({ user: { id: "legacy-member", role: "RESEARCHER" } })
    ).toMatchObject({ accountLevel: "member", facilityWorkflowRole: "requester" });
  });

  it("fails closed for invalid authorization metadata", () => {
    expect(
      principalFromSession({
        user: { id: "invalid", systemRole: "OWNER", role: "UNKNOWN" },
      })
    ).toBeNull();
    expect(
      principalFromSession({
        user: {
          id: "disabled",
          systemRole: "ADMIN",
          role: "FACILITY_ADMIN",
          authorizationValid: false,
        },
      })
    ).toBeNull();
  });
});
