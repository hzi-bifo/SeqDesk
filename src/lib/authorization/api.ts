import { NextResponse } from "next/server";

import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";

import { decideCapability } from "./guards";
import type {
  Capability,
  CapabilityDecision,
} from "./types";
import type { SessionPrincipalInput } from "./principal";

export function decideServerCapability(
  session: SessionPrincipalInput | null | undefined,
  capability: Capability
): CapabilityDecision {
  return decideCapability(session, capability, getServerDeploymentProfile());
}

export function authorizationErrorResponse(
  decision: CapabilityDecision
): NextResponse {
  const error =
    decision.status === 401
      ? "Unauthorized"
      : decision.status === 404
        ? "Not found"
        : "Forbidden";

  return NextResponse.json({ error }, { status: decision.status });
}
