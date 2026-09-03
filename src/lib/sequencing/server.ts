import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isActiveSession } from "@/lib/auth-session";
import { decideCapability } from "@/lib/authorization";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { isDemoSession } from "@/lib/demo/server";

export class SequencingApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireFacilityAdminSequencingSession(): Promise<Session> {
  const session = await getServerSession(authOptions);

  if (!isActiveSession(session)) {
    throw new SequencingApiError(401, "Unauthorized");
  }

  if (isDemoSession(session)) {
    throw new SequencingApiError(
      403,
      "Sequencing data management is disabled in the public demo."
    );
  }

  const decision = decideCapability(
    session,
    "sequencing.runs.manage",
    getServerDeploymentProfile()
  );
  if (!decision.allowed) {
    throw new SequencingApiError(
      decision.status,
      decision.status === 404
        ? "Sequencing operations are not available"
        : decision.status === 401
          ? "Unauthorized"
          : "You do not have permission to manage sequencing data"
    );
  }

  return session;
}

/** Read-only variant that allows demo users to view sequencing data. */
export async function requireFacilityAdminSequencingReadSession(): Promise<Session> {
  const session = await getServerSession(authOptions);

  if (!isActiveSession(session)) {
    throw new SequencingApiError(401, "Unauthorized");
  }

  const decision = decideCapability(
    session,
    "sequencing.runs.manage",
    getServerDeploymentProfile()
  );
  if (!decision.allowed) {
    throw new SequencingApiError(
      decision.status,
      decision.status === 404
        ? "Sequencing operations are not available"
        : decision.status === 401
          ? "Unauthorized"
          : "You do not have permission to manage sequencing data"
    );
  }

  return session;
}
