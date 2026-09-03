import {
  decideCapability,
  type CapabilityDecision,
  type SessionPrincipalInput,
} from "@/lib/authorization";
import type { DeploymentProfileDefinition } from "@/lib/deployment-profile";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";

export function decideStudyReadAccess(
  session: SessionPrincipalInput | null | undefined,
  profile: DeploymentProfileDefinition = getServerDeploymentProfile()
): CapabilityDecision {
  const readAll = decideCapability(session, "studies.read_all", profile);
  return readAll.allowed
    ? readAll
    : decideCapability(session, "studies.read", profile);
}

export function decideStudyMutationAccess(
  session: SessionPrincipalInput | null | undefined,
  profile: DeploymentProfileDefinition = getServerDeploymentProfile()
): CapabilityDecision {
  return decideCapability(session, "samples.manage", profile);
}

export function canAccessStudyOwner(
  decision: CapabilityDecision,
  ownerId: string
): boolean {
  return Boolean(
    decision.allowed &&
      decision.grant &&
      decision.principal &&
      (decision.grant.scope === "installation" ||
        decision.principal.id === ownerId)
  );
}

export function canUseOperationalStudyFields(
  session: SessionPrincipalInput | null | undefined,
  profile: DeploymentProfileDefinition = getServerDeploymentProfile()
): boolean {
  return decideCapability(session, "orders.process", profile).allowed;
}

export function studyAuthorizationError(
  decision: CapabilityDecision
): "Unauthorized" | "Forbidden" | "Not found" {
  if (decision.status === 401) return "Unauthorized";
  if (decision.status === 404) return "Not found";
  return "Forbidden";
}
