import type {
  DeploymentDomainId,
  DeploymentModuleId,
  DeploymentProfileDefinition,
} from "./types";
import { DEFAULT_MODULE_STATES } from "@/lib/modules/types";

export type DeploymentCompatibilitySeverity = "error" | "warning";

export interface DeploymentCompatibilityIssue {
  severity: DeploymentCompatibilitySeverity;
  code: string;
  message: string;
  moduleId?: string;
}

export interface DeploymentCompatibilityOptions {
  pipelinesEnabled?: boolean;
  /** Feature-module switches from SiteSettings or an install profile. */
  featureModules?: Record<string, unknown>;
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

/**
 * Domain requirements for the smaller, administrator-configurable feature
 * modules. These are deliberately separate from DeploymentModuleId: the
 * latter describes the application topology selected by a deployment profile,
 * while these switches customize features inside that topology.
 */
export const FEATURE_MODULE_DOMAIN_REQUIREMENTS = {
  "ai-validation": ["facility-intake"],
  "mixs-metadata": ["sample-catalog"],
  "account-validation": ["core"],
  "funding-info": ["facility-intake"],
  "billing-info": ["facility-intake"],
  "ena-sample-fields": ["sample-catalog", "publishing"],
  "sequencing-tech": ["sequencing-operations"],
  "dynamic-studies": ["sample-catalog"],
  notifications: ["core"],
} as const satisfies Readonly<Record<string, readonly DeploymentDomainId[]>>;

export type FeatureModuleId = keyof typeof FEATURE_MODULE_DOMAIN_REQUIREMENTS;

export interface EffectiveFeatureModuleResolution {
  modules: Record<FeatureModuleId, boolean>;
  incompatibleModules: FeatureModuleId[];
}

const ALWAYS_ENABLED_FEATURE_MODULES = new Set<FeatureModuleId>([
  "sequencing-tech",
]);

function readModuleToggle(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === 1) return true;
  if (value === 0) return false;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "y", "1", "on"].includes(normalized)) return true;
  if (["false", "no", "n", "0", "off"].includes(normalized)) return false;
  return undefined;
}

export function normalizeFeatureModuleToggles(
  modules: Record<string, unknown>
): Record<string, boolean> {
  const normalized: Record<string, boolean> = {};
  for (const [moduleId, value] of Object.entries(modules)) {
    const enabled = readModuleToggle(value);
    if (enabled !== undefined) normalized[moduleId] = enabled;
  }
  return normalized;
}

/**
 * Resolve the complete runtime feature-module state for one deployment profile.
 *
 * Defaults and stored overrides are both constrained by the profile's domains.
 * Invalid stored values and modules outside the selected profile fail closed at
 * runtime; entry-point validators separately reject explicit invalid overrides
 * with actionable diagnostics before they are persisted.
 */
export function resolveEffectiveFeatureModuleStates(
  profile: DeploymentProfileDefinition,
  configuredModules: Record<string, unknown> = {}
): EffectiveFeatureModuleResolution {
  const domains = new Set(profile.domains);
  const incompatibleModules: FeatureModuleId[] = [];
  const entries = Object.entries(FEATURE_MODULE_DOMAIN_REQUIREMENTS).map(
    ([moduleId, requiredDomains]) => {
      const typedModuleId = moduleId as FeatureModuleId;
      if (requiredDomains.some((domain) => !domains.has(domain))) {
        incompatibleModules.push(typedModuleId);
        return [typedModuleId, false] as const;
      }

      if (ALWAYS_ENABLED_FEATURE_MODULES.has(typedModuleId)) {
        return [typedModuleId, true] as const;
      }

      if (Object.prototype.hasOwnProperty.call(configuredModules, moduleId)) {
        return [
          typedModuleId,
          readModuleToggle(configuredModules[moduleId]) ?? false,
        ] as const;
      }

      return [typedModuleId, DEFAULT_MODULE_STATES[moduleId] === true] as const;
    }
  );

  return {
    modules: Object.fromEntries(entries) as Record<FeatureModuleId, boolean>,
    incompatibleModules,
  };
}

export function validateFeatureModuleCompatibility(
  profile: DeploymentProfileDefinition,
  configuredModules: Record<string, unknown>,
  options: { explicitModuleIds?: ReadonlySet<string> } = {}
): DeploymentCompatibilityIssue[] {
  const issues: DeploymentCompatibilityIssue[] = [];
  const domains = new Set(profile.domains);

  for (const [moduleId, rawEnabled] of Object.entries(configuredModules)) {
    const requiredDomains = (
      FEATURE_MODULE_DOMAIN_REQUIREMENTS as Readonly<
        Record<string, readonly DeploymentDomainId[] | undefined>
      >
    )[moduleId];
    if (!requiredDomains) {
      issues.push({
        severity: "error",
        code: "unknown-feature-module",
        moduleId,
        message: `modules.${moduleId} is not a recognized SeqDesk feature module. Remove it or update SeqDesk to a release that declares it.`,
      });
      continue;
    }

    const enabled = readModuleToggle(rawEnabled);
    if (enabled === undefined) {
      issues.push({
        severity: "error",
        code: "invalid-feature-module-toggle",
        moduleId,
        message: `modules.${moduleId} must be true or false.`,
      });
      continue;
    }

    const missingDomains = requiredDomains.filter((domain) => !domains.has(domain));

    if (!enabled) {
      if (
        ALWAYS_ENABLED_FEATURE_MODULES.has(moduleId as FeatureModuleId) &&
        missingDomains.length === 0 &&
        (!options.explicitModuleIds || options.explicitModuleIds.has(moduleId))
      ) {
        issues.push({
          severity: "error",
          code: "always-enabled-feature-module-disabled",
          moduleId,
          message: `modules.${moduleId} cannot be disabled because SeqDesk currently treats it as always enabled. Remove this override; the deployment profile controls whether its domain is available.`,
        });
      }
      continue;
    }

    if (missingDomains.length > 0) {
      issues.push({
        severity: "error",
        code: "feature-module-domain-missing",
        moduleId,
        message: `${profile.label} cannot enable modules.${moduleId}: it requires ${missingDomains.join(
          " and "
        )}, which this deployment profile does not provide. Disable modules.${moduleId} or choose a compatible deployment profile.`,
      });
    }
  }

  return issues;
}

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

  const configuredFeatureModules = options.featureModules ?? {};
  const effectiveDefaults = resolveEffectiveFeatureModuleStates(profile).modules;
  const completeFeatureModuleState = {
    ...effectiveDefaults,
    ...configuredFeatureModules,
  };
  issues.push(
    ...validateFeatureModuleCompatibility(profile, completeFeatureModuleState, {
      explicitModuleIds: new Set(Object.keys(configuredFeatureModules)),
    })
  );

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
