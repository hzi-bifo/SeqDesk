import { describe, expect, it } from "vitest";

import { ONBOARDING_SCHEMA_VERSION, getOnboardingItems, resolveOnboardingCapabilities } from "./definitions";
import { buildOnboardingStatus, parseStoredOnboardingState } from "./status";

const withPipelines = resolveOnboardingCapabilities({
  profile: "research-workbench", modulesConfig: null, pipelinesEnabled: true,
});

describe("module-aware onboarding status", () => {
  it("composes one journey from enabled modules independently of the installation preset", () => {
    for (const profile of ["sequencing-center", "shared-lab", "research-workbench"] as const) {
      const capabilities = resolveOnboardingCapabilities({
        profile, modulesConfig: JSON.stringify({ modules: { "sequencing-management": true } }), pipelinesEnabled: true,
      });
      const items = getOnboardingItems(profile, capabilities);
      expect(items.map(item => item.id)).toEqual(getOnboardingItems("sequencing-center", capabilities).map(item => item.id));
      expect(items.map(item => item.section)).toEqual(expect.arrayContaining(["facility", "imports", "pipelines", "reports"]));
      expect(items.every(item => !item.href?.startsWith("/workbench"))).toBe(true);
    }
  });

  it("respects global-disabled feature modules without removing shared essentials or independent workflow checks", () => {
    const capabilities = resolveOnboardingCapabilities({
      profile: "shared-lab", modulesConfig: JSON.stringify({ globalDisabled: true }), pipelinesEnabled: true,
    });
    const items = getOnboardingItems("shared-lab", capabilities);
    expect(new Set(items.map(item => item.section))).toEqual(new Set(["essentials", "pipelines"]));
    expect(items.find(item => item.id === "verify-storage")).toMatchObject({ requirement: "required", completionMode: "automatic" });
  });

  it("uses only enabled import catalog names and does not require Nextflow for Reports alone", () => {
    const capabilities = resolveOnboardingCapabilities({
      profile: "sequencing-center", modulesConfig: JSON.stringify({ modules: { "sequencing-management": false, "import-cami": false, "import-sra": true, explore: true } }), pipelinesEnabled: false,
    });
    const items = getOnboardingItems("sequencing-center", capabilities);
    expect(items.find(item => item.id === "confirm-import-policy")?.description).toContain("SRA / ENA reads");
    expect(items.find(item => item.id === "confirm-import-policy")?.description).not.toContain("CAMI");
    expect(items.some(item => item.section === "facility" || item.section === "pipelines")).toBe(false);
    expect(items.some(item => item.section === "reports")).toBe(true);
  });

  it("retains equivalent legacy confirmations without discarding hidden-module completion", () => {
    const completion = { completedAt: "2026-09-03T12:00:00.000Z", completedByUserId: "admin-1" };
    const status = buildOnboardingStatus({
      profile: "shared-lab", requiredVersion: 0,
      capabilities: { ...withPipelines, facilityEnabled: true },
      stored: { schemaVersion: 1, profile: "shared-lab", items: { "configure-shared-instruments": completion, "review-shared-pipelines": completion } },
    });
    expect(status.items.find(item => item.id === "configure-sequencers")).toMatchObject({ complete: true, completion });
    expect(status.items.find(item => item.id === "review-analysis-pipelines")).toMatchObject({ complete: true, completion });
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

  it("blocks a newly installed profile only on required readiness items", () => {
    const definitions = getOnboardingItems("research-workbench", withPipelines);
    const completedAt = "2026-09-03T12:00:00.000Z";
    const requiredDefinitions = definitions.filter(
      (item) => item.requirement === "required"
    );
    const stored = {
      schemaVersion: ONBOARDING_SCHEMA_VERSION,
      profile: "research-workbench" as const,
      items: Object.fromEntries(
        requiredDefinitions.slice(0, -1).map((item) => [
          item.id,
          { completedAt, completedByUserId: "admin-1" },
        ])
      ),
    };
    const status = buildOnboardingStatus({
      profile: "research-workbench",
      capabilities: withPipelines,
      requiredVersion: 1,
      stored,
      automaticChecks: {
        [requiredDefinitions[0].id]: {
          status: "verified",
          summary: "Automatically verified.",
          checkedAt: completedAt,
        },
      },
    });
    expect(status.required).toBe(true);
    expect(status.complete).toBe(false);
    expect(status.requiredCompletedCount).toBe(status.requiredTotalCount - 1);
  });

  it("uses automatic evidence instead of a stored checkbox for required checks", () => {
    const completedAt = "2026-09-03T12:00:00.000Z";
    const stored = {
      schemaVersion: ONBOARDING_SCHEMA_VERSION,
      profile: "research-workbench" as const,
      items: {
        "verify-storage": { completedAt, completedByUserId: "admin-1" },
        "verify-workflow-runtime": {
          completedAt,
          completedByUserId: "admin-1",
        },
      },
    };

    const unchecked = buildOnboardingStatus({
      profile: "research-workbench",
      capabilities: withPipelines,
      requiredVersion: 1,
      stored,
    });
    expect(unchecked.complete).toBe(false);
    expect(unchecked.requiredCompletedCount).toBe(0);
    expect(
      unchecked.items.find((item) => item.id === "verify-storage")
        ?.completionMode
    ).toBe("automatic");

    const verified = buildOnboardingStatus({
      profile: "research-workbench",
      capabilities: withPipelines,
      requiredVersion: 1,
      stored,
      automaticChecks: {
        "verify-storage": {
          status: "verified",
          summary: "Managed storage is writable.",
          checkedAt: completedAt,
        },
        "verify-workflow-runtime": {
          status: "verified",
          summary: "Workflow runtime is ready.",
          checkedAt: completedAt,
        },
      },
    });
    expect(verified.complete).toBe(true);
    expect(verified.requiredCompletedCount).toBe(2);
  });

  it("does not block members on unfinished recommendations", () => {
    const definitions = getOnboardingItems("shared-lab");
    const completedAt = "2026-09-03T12:00:00.000Z";
    const stored = {
      schemaVersion: ONBOARDING_SCHEMA_VERSION,
      profile: "shared-lab" as const,
      items: Object.fromEntries(
        definitions
          .filter((item) => item.requirement === "required")
          .map((item) => [
            item.id,
            { completedAt, completedByUserId: "admin-1" },
          ])
      ),
      completedAt,
      completedByUserId: "admin-1",
    };

    const status = buildOnboardingStatus({
      profile: "shared-lab",
      requiredVersion: 1,
      stored,
      automaticChecks: {
        "verify-storage": {
          status: "verified",
          summary: "Managed storage is writable.",
          checkedAt: completedAt,
        },
      },
    });

    expect(status.complete).toBe(true);
    expect(status.recommendationsComplete).toBe(false);
    expect(status.requiredCompletedCount).toBe(status.requiredTotalCount);
    expect(status.completedCount).toBeLessThan(status.totalCount);
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

  it("parses only valid automatic verification evidence", () => {
    const stored = parseStoredOnboardingState(
      {
        schemaVersion: 1,
        profile: "shared-lab",
        items: {},
        automaticVerifications: {
          "verify-storage": {
            completedAt: "2026-09-03T12:00:00.000Z",
            completedByUserId: "admin-1",
            verifierVersion: 1,
            configurationFingerprint: "fingerprint",
          },
          invalid: {
            completedAt: "2026-09-03T12:00:00.000Z",
            completedByUserId: "admin-1",
            verifierVersion: 0,
            configurationFingerprint: "",
          },
        },
      },
      "shared-lab"
    );

    expect(stored?.automaticVerifications).toEqual({
      "verify-storage": {
        completedAt: "2026-09-03T12:00:00.000Z",
        completedByUserId: "admin-1",
        verifierVersion: 1,
        configurationFingerprint: "fingerprint",
      },
    });
  });
});
