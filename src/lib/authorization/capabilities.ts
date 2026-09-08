import type { DeploymentProfileDefinition } from "@/lib/deployment-profile";

import {
  CAPABILITY_DOMAINS,
  type Capability,
  type CapabilityGrant,
  type Principal,
  type ResourceScope,
} from "./types";

const SYSTEM_ADMIN_CAPABILITIES = new Set<Capability>([
  "system.settings.manage",
  "system.catalog.manage",
  "system.users.manage",
  "system.updates.manage",
  "system.pipelines.manage",
  "system.sequencing.manage",
  "system.workflows.publish",
  "system.quotas.manage",
  "system.retention.manage",
]);

const SEQUENCING_MEMBER_CAPABILITIES = new Set<Capability>([
  "analysis.run",
  "analysis.cancel_own",
  "workbench.use",
  "workbench.import",
  "orders.create",
  "orders.read",
  "studies.create",
  "studies.read",
  "samples.manage",
  "analysis.read_own",
  "data.archive",
  "support.tickets.use",
]);

const SEQUENCING_OPERATOR_CAPABILITIES = new Set<Capability>([
  ...SEQUENCING_MEMBER_CAPABILITIES,
  "orders.read_all",
  "orders.process",
  "studies.read_all",
  "studies.publish",
  "samples.manage",
  "sequencing.runs.manage",
  "sequencing.files.manage",
  "sequencing.deliver",
  "analysis.run",
  "analysis.read_all",
  "analysis.resolve_outputs",
  "analysis.cancel_own",
  "analysis.cancel_all",
  "data.restore",
  "data.purge_shared",
  "publishing.submit",
  "support.tickets.manage",
]);

const SHARED_LAB_MEMBER_CAPABILITIES = new Set<Capability>([
  "workbench.use",
  "workbench.import",
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
  "data.archive",
  "data.restore",
  "publishing.submit",
]);

const WORKBENCH_MEMBER_CAPABILITIES = new Set<Capability>([
  "orders.read",
  "orders.create",
  "studies.read",
  "studies.create",
  "samples.manage",
  "workbench.use",
  "workbench.import",
  "workbench.run",
  "analysis.run",
  "analysis.read_own",
  "analysis.cancel_own",
  "data.archive",
  "data.restore",
  "publishing.submit",
]);

function grantedCapabilities(
  profile: DeploymentProfileDefinition,
  principal: Principal
): Set<Capability> {
  const capabilities = new Set<Capability>();

  // Service identities are reserved in the principal contract, but no service
  // authentication or grants exist yet. They must fail closed instead of
  // inheriting human permissions from an account-level string.
  if (principal.kind !== "human") return capabilities;

  if (principal.accountLevel === "admin") {
    for (const capability of SYSTEM_ADMIN_CAPABILITIES) {
      capabilities.add(capability);
    }
  }

  if (profile.id === "sequencing-center") {
    if (principal.accountLevel === "admin") {
      capabilities.add("system.facility.manage");
    }
    const grants =
      principal.facilityWorkflowRole === "operator"
        ? SEQUENCING_OPERATOR_CAPABILITIES
        : SEQUENCING_MEMBER_CAPABILITIES;
    for (const capability of grants) capabilities.add(capability);
  } else if (profile.id === "shared-lab") {
    for (const capability of SHARED_LAB_MEMBER_CAPABILITIES) {
      capabilities.add(capability);
    }
    if (principal.accountLevel === "admin") {
      capabilities.add("analysis.cancel_all");
      capabilities.add("data.purge_shared");
    }
  } else {
    for (const capability of WORKBENCH_MEMBER_CAPABILITIES) {
      capabilities.add(capability);
    }
  }

  return capabilities;
}

function resourceScopeFor(
  profile: DeploymentProfileDefinition,
  principal: Principal,
  capability: Capability
): ResourceScope {
  if (capability.startsWith("system.")) return "installation";
  // Imports remain private to their creator even in a collaborative lab or
  // for a facility operator. This does not grant access to another workspace.
  if (capability.startsWith("workbench.")) return "workspace";
  if (profile.id === "research-workbench" && capability.startsWith("analysis.")) return "own";
  if (profile.id === "shared-lab") return "installation";
  if (profile.id === "research-workbench") return "workspace";
  if (
    principal.facilityWorkflowRole === "operator" ||
    capability.endsWith("read_all") ||
    capability.endsWith("cancel_all") ||
    capability === "data.purge_shared"
  ) {
    return "installation";
  }
  return "own";
}

export function isCapabilityDomainAvailable(
  profile: DeploymentProfileDefinition,
  capability: Capability
): boolean {
  return profile.domains.includes(CAPABILITY_DOMAINS[capability]);
}

export function getCapabilityGrant(
  profile: DeploymentProfileDefinition,
  principal: Principal,
  capability: Capability
): CapabilityGrant | null {
  if (!isCapabilityDomainAvailable(profile, capability)) return null;
  if (!grantedCapabilities(profile, principal).has(capability)) return null;

  return {
    profileId: profile.id,
    capability,
    scope: resourceScopeFor(profile, principal, capability),
  };
}

export function hasCapability(
  profile: DeploymentProfileDefinition,
  principal: Principal,
  capability: Capability
): boolean {
  return getCapabilityGrant(profile, principal, capability) !== null;
}
