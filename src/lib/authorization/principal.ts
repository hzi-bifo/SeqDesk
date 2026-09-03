import type { Principal } from "./types";

export interface SessionPrincipalInput {
  user?: {
    id?: string | null;
    role?: string | null;
    systemRole?: string | null;
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
  const legacyRole = session?.user?.role;
  const storedSystemRole = session?.user?.systemRole;
  const legacyRoleValid =
    legacyRole === "RESEARCHER" || legacyRole === "FACILITY_ADMIN";
  const systemRole =
    storedSystemRole === "MEMBER" || storedSystemRole === "ADMIN"
      ? storedSystemRole
      : legacyRoleValid
        ? legacyRole === "FACILITY_ADMIN"
          ? "ADMIN"
          : "MEMBER"
        : null;
  if (
    !id ||
    session?.user?.authorizationValid === false ||
    !systemRole
  ) {
    return null;
  }

  const isAdmin = systemRole === "ADMIN";
  return {
    kind: "human",
    id,
    accountLevel: isAdmin ? "admin" : "member",
    facilityWorkflowRole:
      legacyRole === "FACILITY_ADMIN" ? "operator" : "requester",
    isDemo: Boolean(session.user?.isDemo),
  };
}
