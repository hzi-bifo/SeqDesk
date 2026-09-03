import type { DeploymentProfileDefinition } from "@/lib/deployment-profile";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";

import { getCapabilityGrant, isCapabilityDomainAvailable } from "./capabilities";
import { principalFromSession, type SessionPrincipalInput } from "./principal";
import type { Capability, CapabilityDecision, CapabilityGrant } from "./types";

export class AuthorizationError extends Error {
  constructor(
    public readonly status: 401 | 403 | 404,
    message: string
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function decideCapability(
  session: SessionPrincipalInput | null | undefined,
  capability: Capability,
  profile: DeploymentProfileDefinition = getServerDeploymentProfile()
): CapabilityDecision {
  const principal = principalFromSession(session);
  if (!principal) {
    return { allowed: false, status: 401, reason: "unauthenticated" };
  }

  const grant = getCapabilityGrant(profile, principal, capability);
  if (grant) {
    return {
      allowed: true,
      status: 200,
      reason: "allowed",
      principal,
      grant,
    };
  }

  if (!isCapabilityDomainAvailable(profile, capability)) {
    return {
      allowed: false,
      status: 404,
      reason: "domain-unavailable",
      principal,
    };
  }

  return { allowed: false, status: 403, reason: "forbidden", principal };
}

export function requireCapability(
  session: SessionPrincipalInput | null | undefined,
  capability: Capability,
  profile?: DeploymentProfileDefinition
): CapabilityGrant {
  const decision = decideCapability(session, capability, profile);
  if (decision.allowed && decision.grant) return decision.grant;

  const message =
    decision.status === 401
      ? "Authentication required"
      : decision.status === 404
        ? "Domain not available"
        : "Forbidden";
  throw new AuthorizationError(decision.status as 401 | 403 | 404, message);
}
