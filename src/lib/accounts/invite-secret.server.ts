import { createHash } from "node:crypto";

const INVITE_DIGEST_SCHEME = "sha256";

export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Invitation codes contain 192 random bits before their role prefix. A
 * versioned SHA-256 digest prevents a database/read API leak from disclosing a
 * redeemable secret while leaving room for a future digest scheme migration.
 */
export function digestInviteCode(code: string): string {
  const normalized = normalizeInviteCode(code);
  const digest = createHash("sha256").update(normalized, "utf8").digest("hex");
  return `${INVITE_DIGEST_SCHEME}:${digest}`;
}

export function inviteCodeLookup(code: string) {
  const normalizedCode = normalizeInviteCode(code);
  return {
    normalizedCode,
    codeDigest: digestInviteCode(normalizedCode),
    where: {
      OR: [
        { codeDigest: digestInviteCode(normalizedCode) },
        { code: normalizedCode },
      ],
    },
  } as const;
}
