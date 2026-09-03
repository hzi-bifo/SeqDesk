import { describe, expect, it } from "vitest";

import { DEPLOYMENT_PROFILES } from "./definitions";
import {
  assertDeploymentProfileCompatible,
  validateDeploymentProfileCompatibility,
} from "./compatibility";
import type { DeploymentProfileDefinition } from "./types";

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

  it("rejects Workbench/sequencing composition conflicts", () => {
    const invalid = {
      ...DEPLOYMENT_PROFILES["research-workbench"],
      modules: [...DEPLOYMENT_PROFILES["research-workbench"].modules, "orders"],
    } as DeploymentProfileDefinition;

    expect(validateDeploymentProfileCompatibility(invalid)).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "experience-module-conflict",
      })
    );
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
});
