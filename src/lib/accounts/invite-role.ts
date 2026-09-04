export const SYSTEM_ROLES = ["MEMBER", "ADMIN"] as const;
export const FACILITY_WORKFLOW_ROLES = ["REQUESTER", "OPERATOR"] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];
export type FacilityWorkflowRole = (typeof FACILITY_WORKFLOW_ROLES)[number];

/** @deprecated Compatibility shape for callers from the coupled-role release. */
export const INVITE_ACCOUNT_ROLES = ["RESEARCHER", "FACILITY_ADMIN"] as const;
export type InviteAccountRole = (typeof INVITE_ACCOUNT_ROLES)[number];

export interface InviteGrant {
  systemRole: SystemRole;
  facilityWorkflowRole: FacilityWorkflowRole;
}

export interface StoredInviteGrant {
  code?: string | null;
  targetSystemRole?: string | null;
  targetFacilityWorkflowRole?: string | null;
}

const MEMBER_INVITE_PREFIX = "M-";
const ADMIN_INVITE_PREFIX = "A-";

export function isSystemRole(value: unknown): value is SystemRole {
  return (
    typeof value === "string" && SYSTEM_ROLES.includes(value as SystemRole)
  );
}

export function isFacilityWorkflowRole(
  value: unknown
): value is FacilityWorkflowRole {
  return (
    typeof value === "string" &&
    FACILITY_WORKFLOW_ROLES.includes(value as FacilityWorkflowRole)
  );
}

export function isInviteAccountRole(value: unknown): value is InviteAccountRole {
  return (
    typeof value === "string" &&
    INVITE_ACCOUNT_ROLES.includes(value as InviteAccountRole)
  );
}

export function legacyRoleForSystemRole(
  systemRole: SystemRole
): InviteAccountRole {
  return systemRole === "ADMIN" ? "FACILITY_ADMIN" : "RESEARCHER";
}

export function grantFromLegacyAccountRole(
  role: InviteAccountRole
): InviteGrant {
  return role === "FACILITY_ADMIN"
    ? { systemRole: "ADMIN", facilityWorkflowRole: "OPERATOR" }
    : { systemRole: "MEMBER", facilityWorkflowRole: "REQUESTER" };
}

export function formatInviteCode(
  token: string,
  systemRole: SystemRole | InviteAccountRole
): string {
  const elevated = systemRole === "ADMIN" || systemRole === "FACILITY_ADMIN";
  return `${elevated ? ADMIN_INVITE_PREFIX : MEMBER_INVITE_PREFIX}${token
    .trim()
    .toUpperCase()}`;
}

/**
 * Explicit stored grants are authoritative. Prefix decoding exists only for
 * invitations created before those grant columns were introduced.
 */
export function getInviteGrant(invite: StoredInviteGrant): InviteGrant {
  if (
    isSystemRole(invite.targetSystemRole) &&
    isFacilityWorkflowRole(invite.targetFacilityWorkflowRole)
  ) {
    return {
      systemRole: invite.targetSystemRole,
      facilityWorkflowRole: invite.targetFacilityWorkflowRole,
    };
  }

  const legacyCode = invite.code?.trim().toUpperCase();
  if (!legacyCode) {
    return { systemRole: "MEMBER", facilityWorkflowRole: "REQUESTER" };
  }
  return legacyCode.startsWith(MEMBER_INVITE_PREFIX)
    ? { systemRole: "MEMBER", facilityWorkflowRole: "REQUESTER" }
    : { systemRole: "ADMIN", facilityWorkflowRole: "OPERATOR" };
}

/** @deprecated Use getInviteGrant. */
export function getInviteAccountRole(code: string): InviteAccountRole {
  return legacyRoleForSystemRole(getInviteGrant({ code }).systemRole);
}
