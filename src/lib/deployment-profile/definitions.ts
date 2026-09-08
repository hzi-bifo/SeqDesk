import type {
  DeploymentProfileDefinition,
  DeploymentProfileId,
} from "./types";

export const DEFAULT_DEPLOYMENT_PROFILE_ID: DeploymentProfileId =
  "sequencing-center";

// Legacy profile identifiers are installation presets, never different applications.
// Ownership/enrollment defaults are retained for existing installations.
const sharedSurface = {
  experience: "sequencing" as const,
  defaultRoute: "/orders" as const,
  domains: ["core", "facility-intake", "sample-catalog", "sequencing-operations", "analysis", "publishing", "support", "workbench"] as const,
  modules: ["orders", "studies", "sequencing-data", "archive-submissions", "support", "pipelines", "administration", "workbench-data", "data-imports", "runs", "results"] as const,
  terminology: { member: "Researcher" as const, workItem: "Order" as const },
};
export const DEPLOYMENT_PROFILES: Readonly<Record<DeploymentProfileId, DeploymentProfileDefinition>> = {
  "sequencing-center": { ...sharedSurface, id: "sequencing-center", label: "Sequencing center preset", shortLabel: "Center",
    description: "SeqDesk with facility sequencing management and raw-read imports.",
    accountModel: "service-roles", ownership: { scientificRecords: "requester" }, enrollment: { defaultPolicy: "self-registration" } },
  "shared-lab": { ...sharedSurface, id: "shared-lab", label: "Shared lab preset", shortLabel: "Lab",
    description: "The same SeqDesk application with collaborative laboratory access.",
    accountModel: "collaborative-lab", ownership: { scientificRecords: "installation" }, enrollment: { defaultPolicy: "invite-only" } },
  "research-workbench": { ...sharedSurface, id: "research-workbench", label: "Research preset", shortLabel: "Research",
    description: "The same SeqDesk application with raw-read imports; facility management is initially disabled.",
    accountModel: "self-service", ownership: { scientificRecords: "workspace" }, enrollment: { defaultPolicy: "invite-only" } },
};

export function getDeploymentProfileDefinition(
  id: DeploymentProfileId
): DeploymentProfileDefinition {
  return DEPLOYMENT_PROFILES[id];
}

export function isModuleEnabled(
  profile: DeploymentProfileDefinition,
  module: DeploymentProfileDefinition["modules"][number]
): boolean {
  return profile.modules.includes(module);
}

const SEQUENCING_EXPERIENCE_PATHS = [
  "/analysis",
  "/api/pipelines/runs",
  "/assemblies",
  "/orders",
  "/studies",
  "/submissions",
] as const;

const MODULE_PATHS: ReadonlyArray<{
  prefix: string;
  module: DeploymentProfileDefinition["modules"][number];
}> = [
  { prefix: "/studies", module: "studies" },
  { prefix: "/sequencing", module: "studies" },
  { prefix: "/messages", module: "support" },
  { prefix: "/api/tickets", module: "support" },
  { prefix: "/api/orders", module: "orders" },
  { prefix: "/api/form-schema", module: "orders" },
  { prefix: "/api/studies", module: "studies" },
  { prefix: "/api/study-form-schema", module: "studies" },
  { prefix: "/api/samples", module: "studies" },
  { prefix: "/api/files", module: "sequencing-data" },
  { prefix: "/api/assemblies", module: "studies" },
  { prefix: "/api/sidebar", module: "orders" },
  { prefix: "/api/notes/mentions", module: "orders" },
  { prefix: "/api/sequencing-tech", module: "sequencing-data" },
  { prefix: "/api/mixs-checklists", module: "studies" },
  { prefix: "/api/mixs-templates", module: "studies" },
  { prefix: "/api/admin/form-config", module: "orders" },
  { prefix: "/api/admin/field-templates", module: "orders" },
  { prefix: "/api/admin/study-definitions", module: "studies" },
  { prefix: "/api/admin/study-form-config", module: "studies" },
  { prefix: "/api/admin/mixs-checklists", module: "studies" },
  { prefix: "/api/admin/sequencing-run-form-config", module: "sequencing-data" },
  { prefix: "/api/admin/sequencing-tech", module: "sequencing-data" },
  { prefix: "/api/admin/minknow", module: "sequencing-data" },
  { prefix: "/api/admin/settings/minknow", module: "sequencing-data" },
  { prefix: "/api/admin/settings/sequencing-files", module: "sequencing-data" },
  { prefix: "/api/admin/settings/ena", module: "archive-submissions" },
  { prefix: "/api/admin/submissions", module: "archive-submissions" },
  { prefix: "/api/admin/seed/dummy-data", module: "orders" },
  { prefix: "/api/admin/seed/example-datasets", module: "studies" },
  { prefix: "/admin/form-builder", module: "orders" },
  { prefix: "/admin/study-form-builder", module: "studies" },
  { prefix: "/admin/study-definitions", module: "studies" },
  { prefix: "/admin/mixs-checklists", module: "studies" },
  { prefix: "/admin/sequencing-tech", module: "sequencing-data" },
  { prefix: "/admin/minknow-stream", module: "sequencing-data" },
  { prefix: "/admin/ena", module: "archive-submissions" },
];

// These legacy route names now host profile-neutral managed-storage controls.
// Match exact routes before the broader sequencing namespace so any future
// child endpoint fails closed in Workbench unless it is explicitly reviewed.
const PROFILE_NEUTRAL_EXACT_PATHS = [
  "/api/admin/settings/sequencing-files",
  "/api/admin/settings/sequencing-files/test",
] as const;

const SEQUENCING_CENTER_ONLY_PATHS = [
  "/admin/departments",
  "/api/admin/departments",
  "/api/departments",
] as const;

function matchesPathPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Route visibility is a deployment concern, not a user authorization check.
 * Shared administration, account settings, and help remain available in every
 * profile; their own authorization guards still decide what a user may do.
 */
export function isRouteAvailableInDeploymentProfile(
  profile: DeploymentProfileDefinition,
  pathname: string
): boolean {
  if (
    pathname === "/workbench" ||
    pathname.startsWith("/workbench/") ||
    pathname === "/api/workbench" ||
    pathname.startsWith("/api/workbench/")
  ) {
    return profile.modules.includes("data-imports");
  }

  if (
    SEQUENCING_CENTER_ONLY_PATHS.some((prefix) =>
      matchesPathPrefix(pathname, prefix)
    )
  ) {
    return profile.id === "sequencing-center";
  }

  if (
    PROFILE_NEUTRAL_EXACT_PATHS.some(
      (profileNeutralPath) => pathname === profileNeutralPath
    )
  ) {
    return true;
  }

  const moduleRule = MODULE_PATHS.find(({ prefix }) =>
    matchesPathPrefix(pathname, prefix)
  );
  if (moduleRule) {
    return profile.modules.includes(moduleRule.module);
  }

  if (
    SEQUENCING_EXPERIENCE_PATHS.some((prefix) =>
      matchesPathPrefix(pathname, prefix)
    )
  ) {
    return profile.experience === "sequencing";
  }

  return true;
}
