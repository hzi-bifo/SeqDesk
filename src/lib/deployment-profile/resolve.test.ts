import { describe, expect, it } from "vitest";

import { DEPLOYMENT_PROFILES } from "./definitions";
import {
  normalizeDeploymentProfileId,
  resolveDeploymentProfile,
  resolveDeploymentProfileId,
} from "./resolve";

describe("deployment profile resolution", () => {
  it("defines all three installation profiles", () => {
    expect(Object.keys(DEPLOYMENT_PROFILES)).toEqual([
      "sequencing-center",
      "shared-lab",
      "research-workbench",
    ]);
  });

  it("defaults existing installations to sequencing center", () => {
    expect(resolveDeploymentProfileId()).toBe("sequencing-center");
  });

  it("resolves every canonical profile", () => {
    expect(normalizeDeploymentProfileId("sequencing-center")).toBe(
      "sequencing-center"
    );
    expect(normalizeDeploymentProfileId("shared-lab")).toBe("shared-lab");
    expect(normalizeDeploymentProfileId("research-workbench")).toBe(
      "research-workbench"
    );
  });

  it("keeps legacy lab and workbench aliases compatible", () => {
    expect(normalizeDeploymentProfileId("lab")).toBe("sequencing-center");
    expect(normalizeDeploymentProfileId("workbench")).toBe(
      "research-workbench"
    );
    expect(resolveDeploymentProfileId({ legacyWorkbenchOnly: "1" })).toBe(
      "research-workbench"
    );
  });

  it("gives canonical configuration precedence over legacy flags", () => {
    expect(
      resolveDeploymentProfileId({
        configuredProfile: "shared-lab",
        legacyPublicSurface: "workbench",
        legacyWorkbenchOnly: "1",
      })
    ).toBe("shared-lab");
  });

  it("returns the profile-specific landing route and experience", () => {
    expect(
      resolveDeploymentProfile({ configuredProfile: "research-workbench" })
    ).toMatchObject({
      experience: "sequencing",
      defaultRoute: "/orders",
    });
    expect(
      resolveDeploymentProfile({ configuredProfile: "shared-lab" })
    ).toMatchObject({ experience: "sequencing", defaultRoute: "/orders" });
  });
});
