import { NextResponse } from "next/server";

import {
  decideCapability,
  type Capability,
  type Principal,
  type SessionPrincipalInput,
} from "@/lib/authorization";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";

type WorkbenchAccess =
  | { allowed: true; userId: string; principal: Principal }
  | { allowed: false; response: NextResponse };

/**
 * Workbench APIs must fail closed outside the Research Workbench profile, even
 * when the caller holds an otherwise similar analysis/system capability.
 */
export function authorizeWorkbenchRequest(
  session: SessionPrincipalInput | null | undefined,
  capability: Capability = "workbench.use"
): WorkbenchAccess {
  const profile = getServerDeploymentProfile();
  const surfaceDecision = decideCapability(session, "workbench.use", profile);
  if (!surfaceDecision.allowed) {
    return {
      allowed: false,
      response: NextResponse.json(
        {
          error:
            surfaceDecision.status === 401
              ? "Unauthorized"
              : surfaceDecision.status === 404
                ? "Workbench is not available in this deployment profile"
                : "Forbidden",
        },
        { status: surfaceDecision.status }
      ),
    };
  }

  const decision =
    capability === "workbench.use"
      ? surfaceDecision
      : decideCapability(session, capability, profile);
  if (!decision.allowed) {
    return {
      allowed: false,
      response: NextResponse.json(
        { error: decision.status === 401 ? "Unauthorized" : "Forbidden" },
        { status: decision.status }
      ),
    };
  }

  return {
    allowed: true,
    userId: decision.principal!.id,
    principal: decision.principal!,
  };
}
