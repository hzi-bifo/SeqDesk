-- New invitation secrets are stored as versioned SHA-256 digests. The legacy
-- plaintext column stays nullable during the compatibility window so active
-- invitations created by an older release can still be redeemed.
ALTER TABLE "AdminInvite"
  ALTER COLUMN "code" DROP NOT NULL,
  ADD COLUMN "codeDigest" TEXT;

CREATE UNIQUE INDEX "AdminInvite_codeDigest_key"
  ON "AdminInvite"("codeDigest");

-- PostgreSQL 14+ provides sha256(bytea) without an extension. Convert existing
-- secrets in place, preserving their grants and original expiration so links
-- already sent to members continue to work without retaining plaintext.
UPDATE "AdminInvite"
SET "codeDigest" = 'sha256:' || encode(sha256(convert_to(upper(btrim("code")), 'UTF8')), 'hex'),
    "code" = NULL
WHERE "code" IS NOT NULL;
