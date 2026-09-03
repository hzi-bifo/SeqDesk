import { describe, expect, it } from "vitest";

import {
  assertBootstrapPlaintextPasswordSupported,
  BCRYPT_MAX_PASSWORD_BYTES,
  resolveBootstrapAdminFacilityWorkflowRole,
  resolveBootstrapDeploymentProfile,
} from "../../../prisma/bootstrap-account-policy.mjs";

describe("bootstrap account deployment policy", () => {
  it.each([
    ["sequencing-center", "OPERATOR"],
    ["shared-lab", "REQUESTER"],
    ["research-workbench", "REQUESTER"],
  ] as const)(
    "gives the %s bootstrap administrator the expected workflow role",
    (profile, expectedRole) => {
      expect(
        resolveBootstrapAdminFacilityWorkflowRole({
          deployment: { profile },
        }),
      ).toBe(expectedRole);
    },
  );

  it("uses the canonical environment override and rejects unknown profiles", () => {
    expect(
      resolveBootstrapDeploymentProfile(
        { deployment: { profile: "sequencing-center" } },
        "shared-lab",
      ),
    ).toBe("shared-lab");
    expect(() =>
      resolveBootstrapDeploymentProfile(
        { deployment: { profile: "unknown" } },
        undefined,
      ),
    ).toThrow("Unsupported SeqDesk deployment profile");
  });

  it("enforces bcrypt's limit in UTF-8 bytes without logging the password", () => {
    const exactlyAtLimit = "🔬".repeat(18);
    const overLimit = "🔬".repeat(19);

    expect(Buffer.byteLength(exactlyAtLimit, "utf8")).toBe(
      BCRYPT_MAX_PASSWORD_BYTES,
    );
    expect(() =>
      assertBootstrapPlaintextPasswordSupported(exactlyAtLimit, "admin"),
    ).not.toThrow();

    let message = "";
    try {
      assertBootstrapPlaintextPasswordSupported(overLimit, "admin");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("72-byte UTF-8 limit");
    expect(message).not.toContain(overLimit);
  });
});
