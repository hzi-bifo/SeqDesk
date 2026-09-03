import type {
  DeploymentDomainId,
  DeploymentModuleId,
  DeploymentProfileDefinition,
} from "./types";

export type DeploymentCompatibilitySeverity = "error" | "warning";

export interface DeploymentCompatibilityIssue {
  severity: DeploymentCompatibilitySeverity;
  code: string;
  message: string;
}

export interface DeploymentCompatibilityOptions {
  pipelinesEnabled?: boolean;
}

const MODULE_DOMAIN_REQUIREMENTS: Readonly<
  Record<DeploymentModuleId, readonly DeploymentDomainId[]>
> = {
  orders: ["facility-intake", "sample-catalog"],
  studies: ["sample-catalog"],
  "sequencing-data": ["sequencing-operations"],
  "archive-submissions": ["publishing"],
  support: ["support"],
  "workbench-data": ["workbench"],
  "data-imports": ["workbench"],
  pipelines: ["analysis"],
  runs: ["analysis"],
  results: ["analysis"],
  administration: ["core"],
};

const WORKBENCH_MODULES = new Set<DeploymentModuleId>([
  "workbench-data",
  "data-imports",
  "runs",
  "results",
]);

const SEQUENCING_MODULES = new Set<DeploymentModuleId>([
  "orders",
  "studies",
  "sequencing-data",
  "archive-submissions",
  "support",
]);

function duplicateValues<T extends string>(values: readonly T[]): T[] {
  const seen = new Set<T>();
  const duplicates = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function validateDeploymentProfileCompatibility(
  profile: DeploymentProfileDefinition,
  options: DeploymentCompatibilityOptions = {}
): DeploymentCompatibilityIssue[] {
  const issues: DeploymentCompatibilityIssue[] = [];
  const domains = new Set(profile.domains);
  const modules = new Set(profile.modules);

  for (const duplicate of duplicateValues(profile.domains)) {
    issues.push({
      severity: "error",
      code: "duplicate-domain",
      message: `${profile.id} lists domain ${duplicate} more than once.`,
    });
  }
  for (const duplicate of duplicateValues(profile.modules)) {
    issues.push({
      severity: "error",
      code: "duplicate-module",
      message: `${profile.id} lists module ${duplicate} more than once.`,
    });
  }

  for (const moduleId of profile.modules) {
    for (const requiredDomain of MODULE_DOMAIN_REQUIREMENTS[moduleId]) {
      if (!domains.has(requiredDomain)) {
        issues.push({
          severity: "error",
          code: "module-domain-missing",
          message: `${profile.id} enables ${moduleId} without required domain ${requiredDomain}.`,
        });
      }
    }
  }

  if (profile.experience === "workbench") {
    if (!domains.has("workbench")) {
      issues.push({
        severity: "error",
        code: "workbench-domain-missing",
        message: `${profile.id} uses the Workbench experience without the workbench domain.`,
      });
    }
    for (const requiredModule of WORKBENCH_MODULES) {
      if (!modules.has(requiredModule)) {
        issues.push({
          severity: "error",
          code: "workbench-module-missing",
          message: `${profile.id} uses the Workbench experience without required module ${requiredModule}.`,
        });
      }
    }
    for (const sequencingModule of SEQUENCING_MODULES) {
      if (modules.has(sequencingModule)) {
        issues.push({
          severity: "error",
          code: "experience-module-conflict",
          message: `${profile.id} mixes Workbench with sequencing module ${sequencingModule}.`,
        });
      }
    }
    if (profile.ownership.scientificRecords !== "workspace") {
      issues.push({
        severity: "error",
        code: "workbench-ownership-invalid",
        message: `${profile.id} must scope scientific records to workspaces.`,
      });
    }
    if (options.pipelinesEnabled === false) {
      issues.push({
        severity: "warning",
        code: "workflow-execution-disabled",
        message:
          "Research Workbench can import data, but is not operationally complete until workflow execution is enabled.",
      });
    }
  } else {
    if (domains.has("workbench") || [...WORKBENCH_MODULES].some((moduleId) => modules.has(moduleId))) {
      issues.push({
        severity: "error",
        code: "experience-module-conflict",
        message: `${profile.id} mixes the sequencing experience with Workbench domains or modules.`,
      });
    }
  }

  if (
    profile.id === "shared-lab" &&
    profile.ownership.scientificRecords !== "installation"
  ) {
    issues.push({
      severity: "error",
      code: "shared-lab-ownership-invalid",
      message: "shared-lab must use installation-wide scientific record ownership.",
    });
  }

  if (
    profile.id === "sequencing-center" &&
    profile.ownership.scientificRecords !== "requester"
  ) {
    issues.push({
      severity: "error",
      code: "sequencing-center-ownership-invalid",
      message: "sequencing-center must retain requester-scoped scientific records.",
    });
  }

  return issues;
}

export function assertDeploymentProfileCompatible(
  profile: DeploymentProfileDefinition,
  options: DeploymentCompatibilityOptions = {}
): void {
  const errors = validateDeploymentProfileCompatibility(profile, options).filter(
    (issue) => issue.severity === "error"
  );
  if (errors.length > 0) {
    throw new Error(
      `Invalid deployment profile ${profile.id}: ${errors
        .map((issue) => issue.message)
        .join(" ")}`
    );
  }
}
