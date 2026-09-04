-- New invitation secrets are stored as versioned SHA-256 digests. The legacy
-- plaintext column stays nullable during the compatibility window so active
-- invitations created by an older release can still be redeemed.
ALTER TABLE "AdminInvite"
  ALTER COLUMN "code" DROP NOT NULL,
  ADD COLUMN "codeDigest" TEXT;

CREATE UNIQUE INDEX "AdminInvite_codeDigest_key"
  ON "AdminInvite"("codeDigest");

-- Inactive secrets have no compatibility value and should not survive the
-- migration. Active legacy invitations are cleared when used/revoked, upgraded
-- to a digest when verified, or removed from plaintext history after expiry by
-- the authenticated invitation-list cleanup.
UPDATE "AdminInvite"
SET "code" = NULL
WHERE "usedAt" IS NOT NULL
   OR "revokedAt" IS NOT NULL
   OR "expiresAt" <= CURRENT_TIMESTAMP;
