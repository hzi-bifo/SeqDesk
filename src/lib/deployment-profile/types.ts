export const DEPLOYMENT_PROFILE_IDS = [
  "sequencing-center",
  "shared-lab",
  "research-workbench",
] as const;

export type DeploymentProfileId = (typeof DEPLOYMENT_PROFILE_IDS)[number];

export type DeploymentExperience = "sequencing" | "workbench";

export type DeploymentDomainId =
  | "core"
  | "facility-intake"
  | "sample-catalog"
  | "sequencing-operations"
  | "analysis"
  | "publishing"
  | "support"
  | "workbench";

export type DeploymentOwnershipScope =
  | "requester"
  | "installation"
  | "workspace";

export type DeploymentModuleId =
  | "orders"
  | "studies"
  | "sequencing-data"
  | "archive-submissions"
  | "support"
  | "workbench-data"
  | "data-imports"
  | "pipelines"
  | "runs"
  | "results"
  | "administration";

export interface DeploymentProfileDefinition {
  id: DeploymentProfileId;
  label: string;
  shortLabel: string;
  description: string;
  experience: DeploymentExperience;
  defaultRoute: "/orders" | "/workbench/data" | "/sequencing";
  domains: readonly DeploymentDomainId[];
  modules: readonly DeploymentModuleId[];
  accountModel: "service-roles" | "collaborative-lab" | "self-service";
  ownership: {
    scientificRecords: DeploymentOwnershipScope;
  };
  enrollment: {
    defaultPolicy: "self-registration" | "invite-only";
  };
  terminology: {
    member: "Researcher" | "Lab member" | "Member";
    workItem: "Order" | "Project" | "Workspace";
  };
}

export interface DeploymentProfileConfig {
  /** Installation-wide operating model. A change requires an application restart. */
  profile?: DeploymentProfileId;
  /** Version of the authenticated administrator onboarding required by this install. */
  onboardingVersion?: number;
}
