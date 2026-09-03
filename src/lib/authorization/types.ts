import type {
  DeploymentDomainId,
  DeploymentProfileId,
} from "@/lib/deployment-profile";

export const CAPABILITIES = [
  "system.settings.manage",
  "system.catalog.manage",
  "system.users.manage",
  "system.updates.manage",
  "system.pipelines.manage",
  "system.sequencing.manage",
  "system.workflows.publish",
  "system.quotas.manage",
  "system.retention.manage",
  "orders.create",
  "orders.read",
  "orders.read_all",
  "orders.process",
  "studies.create",
  "studies.read",
  "studies.read_all",
  "studies.publish",
  "samples.manage",
  "sequencing.runs.manage",
  "sequencing.files.manage",
  "sequencing.deliver",
  "analysis.run",
  "analysis.read_own",
  "analysis.read_all",
  "analysis.resolve_outputs",
  "analysis.cancel_own",
  "analysis.cancel_all",
  "workbench.use",
  "workbench.import",
  "workbench.run",
  "data.archive",
  "data.restore",
  "data.purge_shared",
  "publishing.submit",
] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type PrincipalKind = "human" | "service";
export type AccountLevel = "member" | "admin";
export type FacilityWorkflowRole = "requester" | "operator";
export type ResourceScope = "own" | "department" | "workspace" | "installation";

export interface Principal {
  kind: PrincipalKind;
  id: string;
  accountLevel: AccountLevel;
  facilityWorkflowRole?: FacilityWorkflowRole;
  isDemo?: boolean;
}

export interface CapabilityGrant {
  profileId: DeploymentProfileId;
  capability: Capability;
  scope: ResourceScope;
}

export interface CapabilityDecision {
  allowed: boolean;
  status: 200 | 401 | 403 | 404;
  reason: "allowed" | "unauthenticated" | "domain-unavailable" | "forbidden";
  principal?: Principal;
  grant?: CapabilityGrant;
}

export const CAPABILITY_DOMAINS: Readonly<Record<Capability, DeploymentDomainId>> = {
  "system.settings.manage": "core",
  "system.catalog.manage": "sample-catalog",
  "system.users.manage": "core",
  "system.updates.manage": "core",
  "system.pipelines.manage": "analysis",
  "system.sequencing.manage": "sequencing-operations",
  "system.workflows.publish": "analysis",
  "system.quotas.manage": "core",
  "system.retention.manage": "core",
  "orders.create": "facility-intake",
  "orders.read": "facility-intake",
  "orders.read_all": "facility-intake",
  "orders.process": "facility-intake",
  "studies.create": "sample-catalog",
  "studies.read": "sample-catalog",
  "studies.read_all": "sample-catalog",
  "studies.publish": "publishing",
  "samples.manage": "sample-catalog",
  "sequencing.runs.manage": "sequencing-operations",
  "sequencing.files.manage": "sequencing-operations",
  "sequencing.deliver": "sequencing-operations",
  "analysis.run": "analysis",
  "analysis.read_own": "analysis",
  "analysis.read_all": "analysis",
  "analysis.resolve_outputs": "analysis",
  "analysis.cancel_own": "analysis",
  "analysis.cancel_all": "analysis",
  "workbench.use": "workbench",
  "workbench.import": "workbench",
  "workbench.run": "workbench",
  "data.archive": "core",
  "data.restore": "core",
  "data.purge_shared": "core",
  "publishing.submit": "publishing",
};
