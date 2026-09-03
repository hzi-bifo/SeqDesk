import type { Principal } from "./types";

export interface SessionPrincipalInput {
  user?: {
    id?: string | null;
    role?: string | null;
    isDemo?: boolean;
    authorizationValid?: boolean;
  } | null;
}

/**
 * Compatibility adapter for stored roles. New authorization code should use
 * account levels and capabilities rather than compare legacy role strings.
 */
export function principalFromSession(
  session: SessionPrincipalInput | null | undefined
): Principal | null {
  const id = session?.user?.id;
  if (
    !id ||
    session?.user?.authorizationValid === false ||
    (session?.user?.role !== "RESEARCHER" &&
      session?.user?.role !== "FACILITY_ADMIN")
  ) {
    return null;
  }

  const isAdmin = session.user?.role === "FACILITY_ADMIN";
  return {
    kind: "human",
    id,
    accountLevel: isAdmin ? "admin" : "member",
    facilityWorkflowRole: isAdmin ? "operator" : "requester",
    isDemo: Boolean(session.user?.isDemo),
  };
}
