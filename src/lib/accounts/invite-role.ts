export const INVITE_ACCOUNT_ROLES = ["RESEARCHER", "FACILITY_ADMIN"] as const;

export type InviteAccountRole = (typeof INVITE_ACCOUNT_ROLES)[number];

const MEMBER_INVITE_PREFIX = "M-";
const ADMIN_INVITE_PREFIX = "A-";

export function isInviteAccountRole(value: unknown): value is InviteAccountRole {
  return (
    typeof value === "string" &&
    INVITE_ACCOUNT_ROLES.includes(value as InviteAccountRole)
  );
}

export function formatInviteCode(
  token: string,
  role: InviteAccountRole
): string {
  const prefix = role === "RESEARCHER" ? MEMBER_INVITE_PREFIX : ADMIN_INVITE_PREFIX;
  return `${prefix}${token.trim().toUpperCase()}`;
}

/**
 * Legacy, unprefixed AdminInvite rows were created exclusively for
 * administrators, so they remain administrator invitations.
 */
export function getInviteAccountRole(code: string): InviteAccountRole {
  return code.trim().toUpperCase().startsWith(MEMBER_INVITE_PREFIX)
    ? "RESEARCHER"
    : "FACILITY_ADMIN";
}
