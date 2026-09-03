import type {
  DeploymentProfileDefinition,
  DeploymentProfileId,
} from "./types";

export const DEFAULT_DEPLOYMENT_PROFILE_ID: DeploymentProfileId =
  "sequencing-center";

export const DEPLOYMENT_PROFILES: Readonly<
  Record<DeploymentProfileId, DeploymentProfileDefinition>
> = {
  "sequencing-center": {
    id: "sequencing-center",
    label: "Sequencing center",
    shortLabel: "Center",
    description:
      "A service facility that receives sequencing requests from researchers and manages them through delivery and archive submission.",
    experience: "sequencing",
    defaultRoute: "/orders",
    accountModel: "service-roles",
    domains: [
      "core",
      "facility-intake",
      "sample-catalog",
      "sequencing-operations",
      "analysis",
      "publishing",
    ],
    ownership: { scientificRecords: "requester" },
    enrollment: { defaultPolicy: "self-registration" },
    terminology: { member: "Researcher", workItem: "Order" },
    modules: [
      "orders",
      "studies",
      "sequencing-data",
      "archive-submissions",
      "support",
      "pipelines",
      "administration",
    ],
  },
  "shared-lab": {
    id: "shared-lab",
    label: "Shared lab",
    shortLabel: "Lab",
    description:
      "One laboratory shares sequencing projects and workflows, with one or more administrators responsible for configuration.",
    experience: "sequencing",
    defaultRoute: "/orders",
    accountModel: "collaborative-lab",
    domains: [
      "core",
      "facility-intake",
      "sample-catalog",
      "sequencing-operations",
      "analysis",
      "publishing",
    ],
    ownership: { scientificRecords: "installation" },
    enrollment: { defaultPolicy: "invite-only" },
    terminology: { member: "Lab member", workItem: "Project" },
    modules: [
      "orders",
      "studies",
      "sequencing-data",
      "archive-submissions",
      "pipelines",
      "administration",
    ],
  },
  "research-workbench": {
    id: "research-workbench",
    label: "Research workbench",
    shortLabel: "Workbench",
    description:
      "A researcher-focused analysis workspace for uploaded or imported data, pipelines, runs, and results.",
    experience: "workbench",
    defaultRoute: "/workbench/data",
    accountModel: "self-service",
    domains: ["core", "analysis", "publishing", "workbench"],
    ownership: { scientificRecords: "workspace" },
    enrollment: { defaultPolicy: "invite-only" },
    terminology: { member: "Member", workItem: "Workspace" },
    modules: [
      "workbench-data",
      "data-imports",
      "pipelines",
      "runs",
      "results",
      "administration",
    ],
  },
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
  "/assemblies",
  "/orders",
  "/studies",
  "/submissions",
] as const;

const MODULE_PATHS: ReadonlyArray<{
  prefix: string;
  module: DeploymentProfileDefinition["modules"][number];
}> = [
  { prefix: "/messages", module: "support" },
  { prefix: "/api/tickets", module: "support" },
  { prefix: "/api/orders", module: "orders" },
  { prefix: "/api/form-schema", module: "orders" },
  { prefix: "/api/studies", module: "studies" },
  { prefix: "/api/study-form-schema", module: "studies" },
  { prefix: "/api/samples", module: "orders" },
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
  { prefix: "/admin/form-builder", module: "orders" },
  { prefix: "/admin/study-form-builder", module: "studies" },
  { prefix: "/admin/study-definitions", module: "studies" },
  { prefix: "/admin/mixs-checklists", module: "studies" },
  { prefix: "/admin/sequencing-tech", module: "sequencing-data" },
  { prefix: "/admin/minknow-stream", module: "sequencing-data" },
  { prefix: "/admin/ena", module: "archive-submissions" },
];

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
    return profile.experience === "workbench";
  }

  if (
    SEQUENCING_CENTER_ONLY_PATHS.some((prefix) =>
      matchesPathPrefix(pathname, prefix)
    )
  ) {
    return profile.id === "sequencing-center";
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
