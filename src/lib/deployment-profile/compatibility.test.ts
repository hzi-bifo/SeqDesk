import { describe, expect, it } from "vitest";

import { DEPLOYMENT_PROFILES } from "./definitions";
import {
  assertDeploymentProfileCompatible,
  FEATURE_MODULE_DOMAIN_REQUIREMENTS,
  normalizeFeatureModuleToggles,
  resolveEffectiveFeatureModuleStates,
  validateDeploymentProfileCompatibility,
  validateFeatureModuleCompatibility,
} from "./compatibility";
import type { DeploymentProfileDefinition } from "./types";
import { AVAILABLE_MODULES } from "@/lib/modules/types";

describe("deployment profile compatibility", () => {
  it.each(Object.values(DEPLOYMENT_PROFILES).map((profile) => [profile.id, profile]))(
    "accepts the built-in %s profile",
    (_id, profile) => {
      expect(validateDeploymentProfileCompatibility(profile)).toEqual([]);
      expect(() => assertDeploymentProfileCompatible(profile)).not.toThrow();
    }
  );

  it("rejects modules whose required domain is absent", () => {
    const invalid = {
      ...DEPLOYMENT_PROFILES["shared-lab"],
      domains: DEPLOYMENT_PROFILES["shared-lab"].domains.filter(
        (domain) => domain !== "sequencing-operations"
      ),
    } as DeploymentProfileDefinition;

    expect(validateDeploymentProfileCompatibility(invalid)).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "module-domain-missing",
      })
    );
    expect(() => assertDeploymentProfileCompatible(invalid)).toThrow(
      /sequencing-data without required domain sequencing-operations/
    );
  });

  it("allows facility and raw-read source modules to coexist in each preset", () => {
    for (const profile of Object.values(DEPLOYMENT_PROFILES)) {
      expect(profile.modules).toEqual(expect.arrayContaining(["orders", "data-imports", "studies"]));
      expect(validateDeploymentProfileCompatibility(profile)).toEqual([]);
    }
  });

  it("reports disabled Workbench execution as an operational warning, not an invalid profile", () => {
    const profile = DEPLOYMENT_PROFILES["research-workbench"];
    const issues = validateDeploymentProfileCompatibility(profile, {
      pipelinesEnabled: false,
    });

    expect(issues).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "workflow-execution-disabled",
      }),
    ]);
    expect(() =>
      assertDeploymentProfileCompatible(profile, { pipelinesEnabled: false })
    ).not.toThrow();
  });

  it("rejects profile ownership semantics that would broaden or hide records", () => {
    const invalid = {
      ...DEPLOYMENT_PROFILES["research-workbench"],
      ownership: { scientificRecords: "installation" },
    } as DeploymentProfileDefinition;

    expect(validateDeploymentProfileCompatibility(invalid)).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "workbench-ownership-invalid",
      })
    );
  });

  it("declares compatibility metadata for every configurable feature module", () => {
    expect(Object.keys(FEATURE_MODULE_DOMAIN_REQUIREMENTS).sort()).toEqual(
      AVAILABLE_MODULES.map((module) => module.id).sort()
    );
  });

  it.each([
    ["sequencing-center", true, true, true, true],
    ["shared-lab", true, true, true, true],
    ["research-workbench", true, true, true, true],
  ] as const)(
    "resolves facility defaults for the %s profile",
    (profileId, aiValidation, mixsMetadata, enaSampleFields, sequencingTech) => {
      const resolved = resolveEffectiveFeatureModuleStates(
        DEPLOYMENT_PROFILES[profileId]
      );

      expect(resolved.modules).toMatchObject({
        "ai-validation": aiValidation,
        "mixs-metadata": mixsMetadata,
        "ena-sample-fields": enaSampleFields,
        "sequencing-tech": sequencingTech,
        "account-validation": false,
        notifications: false,
      });
      expect(resolved.incompatibleModules.includes("ai-validation")).toBe(
        false
      );
    }
  );

  it("keeps compatible overrides while forcing incompatible stored values off", () => {
    const profile = { ...DEPLOYMENT_PROFILES["research-workbench"], domains: DEPLOYMENT_PROFILES["research-workbench"].domains.filter(d => d !== "facility-intake") };
    const resolved = resolveEffectiveFeatureModuleStates(profile, {
      notifications: true,
      "billing-info": true,
    });

    expect(resolved.modules.notifications).toBe(true);
    expect(resolved.modules["billing-info"]).toBe(false);
    expect(resolved.incompatibleModules).toContain("billing-info");
    expect(
      validateDeploymentProfileCompatibility(profile, {
        featureModules: { notifications: true, "billing-info": true },
      })
    ).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "feature-module-domain-missing",
        moduleId: "billing-info",
      })
    );
  });

  it("accepts feature modules only when their required domains exist", () => {
    expect(
      validateFeatureModuleCompatibility(DEPLOYMENT_PROFILES["shared-lab"], {
        "billing-info": true,
        notifications: "yes",
      })
    ).toEqual([]);

    expect(
      validateFeatureModuleCompatibility(
        { ...DEPLOYMENT_PROFILES["research-workbench"], domains: DEPLOYMENT_PROFILES["research-workbench"].domains.filter(d => d !== "facility-intake" && d !== "sequencing-operations") },
        { "billing-info": true }
      )
    ).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "feature-module-domain-missing",
        moduleId: "billing-info",
        message: expect.stringMatching(/facility-intake.*Disable modules\.billing-info/),
      })
    );
  });

  it("fails closed for unknown, malformed, and misleading always-enabled module switches", () => {
    const issues = validateFeatureModuleCompatibility(
      DEPLOYMENT_PROFILES["sequencing-center"],
      {
        typo: true,
        "billing-info": "sometimes",
        "sequencing-tech": false,
      }
    );

    expect(issues.map((issue) => issue.code)).toEqual([
      "unknown-feature-module",
      "invalid-feature-module-toggle",
      "always-enabled-feature-module-disabled",
    ]);
    expect(issues.every((issue) => issue.message.includes("modules."))).toBe(true);
  });

  it("allows an incompatible always-on module to be explicitly cleared", () => {
    expect(
      validateFeatureModuleCompatibility(
        { ...DEPLOYMENT_PROFILES["research-workbench"], domains: DEPLOYMENT_PROFILES["research-workbench"].domains.filter(d => d !== "facility-intake" && d !== "sequencing-operations") },
        { "sequencing-tech": false }
      )
    ).toEqual([]);
  });

  it("normalizes the boolean spellings accepted by hosted installer profiles", () => {
    expect(
      normalizeFeatureModuleToggles({
        "billing-info": "on",
        notifications: 0,
        "account-validation": "invalid",
      })
    ).toEqual({ "billing-info": true, notifications: false });
  });
});
