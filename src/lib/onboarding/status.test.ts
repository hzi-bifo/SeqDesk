import { describe, expect, it } from "vitest";

import { ONBOARDING_SCHEMA_VERSION, getOnboardingItems } from "./definitions";
import { buildOnboardingStatus, parseStoredOnboardingState } from "./status";

describe("profile onboarding status", () => {
  it("composes distinct first journeys for every deployment profile", () => {
    expect(getOnboardingItems("sequencing-center").map((item) => item.id)).toContain(
      "test-center-journey"
    );
    expect(getOnboardingItems("shared-lab").map((item) => item.id)).toContain(
      "test-shared-journey"
    );
    expect(getOnboardingItems("research-workbench").map((item) => item.id)).toContain(
      "test-workbench-journey"
    );
    expect(getOnboardingItems("research-workbench").map((item) => item.id)).not.toContain(
      "configure-intake"
    );
  });

  it("does not force onboarding onto installations without a required version", () => {
    const status = buildOnboardingStatus({
      profile: "shared-lab",
      requiredVersion: 0,
    });
    expect(status.required).toBe(false);
    expect(status.complete).toBe(true);
    expect(status.completedCount).toBe(0);
  });

  it("requires every current profile item for a newly installed profile", () => {
    const definitions = getOnboardingItems("research-workbench");
    const completedAt = "2026-09-03T12:00:00.000Z";
    const stored = {
      schemaVersion: ONBOARDING_SCHEMA_VERSION,
      profile: "research-workbench" as const,
      items: Object.fromEntries(
        definitions.slice(0, -1).map((item) => [
          item.id,
          { completedAt, completedByUserId: "admin-1" },
        ])
      ),
    };
    const status = buildOnboardingStatus({
      profile: "research-workbench",
      requiredVersion: 1,
      stored,
    });
    expect(status.required).toBe(true);
    expect(status.complete).toBe(false);
    expect(status.completedCount).toBe(status.totalCount - 1);
  });

  it("ignores completion state from a different immutable profile", () => {
    expect(
      parseStoredOnboardingState(
        {
          schemaVersion: 1,
          profile: "sequencing-center",
          items: {
            "verify-storage": {
              completedAt: "2026-09-03T12:00:00.000Z",
              completedByUserId: "admin-1",
            },
          },
        },
        "shared-lab"
      )
    ).toBeUndefined();
  });
});
