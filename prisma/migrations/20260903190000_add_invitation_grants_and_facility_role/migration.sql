-- Separate sequencing-center workflow responsibility from installation access.
-- Keep User.role as a conservative system-role mirror so a rollback never turns
-- a MEMBER+OPERATOR account into an administrator on an older release.
ALTER TABLE "User"
  ADD COLUMN "facilityWorkflowRole" TEXT NOT NULL DEFAULT 'REQUESTER';

UPDATE "User"
SET "facilityWorkflowRole" = CASE
  WHEN "role" = 'FACILITY_ADMIN' THEN 'OPERATOR'
  ELSE 'REQUESTER'
END;

UPDATE "User"
SET "role" = CASE
  WHEN "systemRole" = 'ADMIN' THEN 'FACILITY_ADMIN'
  ELSE 'RESEARCHER'
END;

ALTER TABLE "User"
  ADD CONSTRAINT "User_facilityWorkflowRole_check"
  CHECK ("facilityWorkflowRole" IN ('REQUESTER', 'OPERATOR'));

-- Persist invitation grants explicitly. Prefix decoding remains only as a
-- compatibility fallback for rows created by older releases.
ALTER TABLE "AdminInvite"
  ADD COLUMN "targetSystemRole" TEXT NOT NULL DEFAULT 'MEMBER',
  ADD COLUMN "targetFacilityWorkflowRole" TEXT NOT NULL DEFAULT 'REQUESTER',
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revokedById" TEXT;

UPDATE "AdminInvite"
SET
  "targetSystemRole" = CASE
    WHEN UPPER("code") LIKE 'M-%' THEN 'MEMBER'
    ELSE 'ADMIN'
  END,
  "targetFacilityWorkflowRole" = CASE
    WHEN UPPER("code") LIKE 'M-%' THEN 'REQUESTER'
    ELSE 'OPERATOR'
  END;

ALTER TABLE "AdminInvite"
  ADD CONSTRAINT "AdminInvite_targetSystemRole_check"
    CHECK ("targetSystemRole" IN ('MEMBER', 'ADMIN')),
  ADD CONSTRAINT "AdminInvite_targetFacilityWorkflowRole_check"
    CHECK ("targetFacilityWorkflowRole" IN ('REQUESTER', 'OPERATOR')),
  ADD CONSTRAINT "AdminInvite_revocation_state_check"
    CHECK ("revokedAt" IS NOT NULL OR "revokedById" IS NULL);

CREATE INDEX "AdminInvite_createdById_usedAt_revokedAt_idx"
  ON "AdminInvite"("createdById", "usedAt", "revokedAt");

ALTER TABLE "AdminInvite"
  ADD CONSTRAINT "AdminInvite_revokedById_fkey"
  FOREIGN KEY ("revokedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
