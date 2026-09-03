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
  "/messages",
  "/orders",
  "/studies",
  "/submissions",
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
  if (pathname === "/workbench" || pathname.startsWith("/workbench/")) {
    return profile.experience === "workbench";
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
