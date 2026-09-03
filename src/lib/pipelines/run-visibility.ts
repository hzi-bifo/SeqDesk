import {
  decideCapability,
  principalFromSession,
  type Capability,
  type CapabilityDecision,
  type CapabilityGrant,
  type SessionPrincipalInput,
} from "@/lib/authorization";
import type { DeploymentProfileDefinition } from "@/lib/deployment-profile";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { db } from "@/lib/db";

export type PipelineRunVisibilitySnapshot = {
  userId?: string | null;
  study?: { userId: string } | null;
  order?: { userId: string } | null;
  selectedResultSelections?: Array<{ id: string }> | null;
};

export type PipelineRunAuthorizationError = {
  status: 401 | 403 | 404;
  body: { error: "Unauthorized" | "Forbidden" | "Not found" | "Run not found" };
};

function decisionError(
  decision: CapabilityDecision
): PipelineRunAuthorizationError {
  if (decision.status === 401) {
    return { status: 401, body: { error: "Unauthorized" } };
  }
  if (decision.status === 404) {
    return { status: 404, body: { error: "Not found" } };
  }
  return { status: 403, body: { error: "Forbidden" } };
}

/**
 * The legacy `/api/pipelines/runs` family operates on order/study targets.
 * Workbench analyses have their own workspace-scoped API and must never fall
 * through to these facility routes merely because both profiles enable the
 * analysis domain.
 */
export function decideFacilityPipelineCapability(
  session: SessionPrincipalInput | null | undefined,
  capability: Capability,
  profile: DeploymentProfileDefinition = getServerDeploymentProfile()
): CapabilityDecision {
  const principal = principalFromSession(session);
  if (!principal) {
    return {
      allowed: false,
      status: 401,
      reason: "unauthenticated",
    };
  }

  if (profile.experience === "workbench") {
    return {
      allowed: false,
      status: 404,
      reason: "domain-unavailable",
      principal,
    };
  }

  return decideCapability(session, capability, profile);
}

export function requireFacilityPipelineCapability(
  session: SessionPrincipalInput | null | undefined,
  capability: Capability,
  profile?: DeploymentProfileDefinition
): { grant: CapabilityGrant; principalId: string } | PipelineRunAuthorizationError {
  const decision = decideFacilityPipelineCapability(session, capability, profile);
  if (!decision.allowed || !decision.grant || !decision.principal) {
    return decisionError(decision);
  }
  return { grant: decision.grant, principalId: decision.principal.id };
}

export function isPipelineRunAuthorizationError(
  value:
    | { grant: CapabilityGrant; principalId: string }
    | PipelineRunAuthorizationError
): value is PipelineRunAuthorizationError {
  return "status" in value;
}

export function isPipelineRunPublished(
  run: PipelineRunVisibilitySnapshot
): boolean {
  return (run.selectedResultSelections?.length ?? 0) > 0;
}

export function userOwnsPipelineRunTarget(
  principalId: string,
  run: PipelineRunVisibilitySnapshot
): boolean {
  return run.study?.userId === principalId || run.order?.userId === principalId;
}

export function canReadPipelineRun(
  grant: CapabilityGrant,
  principalId: string,
  run: PipelineRunVisibilitySnapshot,
  options: { ownRequiresPublished?: boolean } = {}
): boolean {
  if (grant.scope === "installation") return true;
  if (grant.scope !== "own") return false;
  return (
    userOwnsPipelineRunTarget(principalId, run) &&
    (options.ownRequiresPublished !== true || isPipelineRunPublished(run))
  );
}

export function authorizePipelineRunRead(
  session: SessionPrincipalInput | null | undefined,
  run: PipelineRunVisibilitySnapshot,
  profile?: DeploymentProfileDefinition,
  options: { ownRequiresPublished?: boolean } = { ownRequiresPublished: true }
): PipelineRunAuthorizationError | null {
  const readAll = requireFacilityPipelineCapability(
    session,
    "analysis.read_all",
    profile
  );
  if (!isPipelineRunAuthorizationError(readAll)) {
    return canReadPipelineRun(readAll.grant, readAll.principalId, run, options)
      ? null
      : { status: 403, body: { error: "Forbidden" } };
  }

  const readOwn = requireFacilityPipelineCapability(
    session,
    "analysis.read_own",
    profile
  );
  if (isPipelineRunAuthorizationError(readOwn)) {
    if (readOwn.status !== 403) return readOwn;
    return readAll.status !== 403 ? readAll : readOwn;
  }

  return canReadPipelineRun(readOwn.grant, readOwn.principalId, run, options)
    ? null
    : { status: 403, body: { error: "Forbidden" } };
}

export async function assertPipelineRunReadAccess(
  runId: string,
  session: SessionPrincipalInput
): Promise<PipelineRunAuthorizationError | null> {
  const run = await db.pipelineRun.findUnique({
    where: { id: runId },
    select: {
      userId: true,
      study: { select: { userId: true } },
      order: { select: { userId: true } },
      selectedResultSelections: {
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!run) {
    return { status: 404, body: { error: "Run not found" } };
  }

  return authorizePipelineRunRead(session, run);
}

export async function assertPipelineRunCancelAccess(
  runId: string,
  session: SessionPrincipalInput
): Promise<PipelineRunAuthorizationError | null> {
  const cancelAll = requireFacilityPipelineCapability(
    session,
    "analysis.cancel_all"
  );
  if (!isPipelineRunAuthorizationError(cancelAll)) return null;

  const cancelOwn = requireFacilityPipelineCapability(
    session,
    "analysis.cancel_own"
  );
  if (isPipelineRunAuthorizationError(cancelOwn)) {
    if (cancelOwn.status !== 403) return cancelOwn;
    return cancelAll.status !== 403 ? cancelAll : cancelOwn;
  }

  const run = await db.pipelineRun.findUnique({
    where: { id: runId },
    select: { userId: true },
  });
  if (!run) {
    return { status: 404, body: { error: "Run not found" } };
  }
  if (run.userId !== cancelOwn.principalId) {
    return { status: 403, body: { error: "Forbidden" } };
  }

  return null;
}
