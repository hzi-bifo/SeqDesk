-- Separate installation administration from the legacy requester/facility role.
-- The old `role` column remains in place for rollback compatibility.
ALTER TABLE "User" ADD COLUMN "systemRole" TEXT;

UPDATE "User"
SET "systemRole" = CASE
  WHEN "role" = 'FACILITY_ADMIN' THEN 'ADMIN'
  ELSE 'MEMBER'
END;

ALTER TABLE "User"
  ALTER COLUMN "systemRole" SET DEFAULT 'MEMBER',
  ALTER COLUMN "systemRole" SET NOT NULL;

ALTER TABLE "User"
  ADD CONSTRAINT "User_systemRole_check"
  CHECK ("systemRole" IN ('MEMBER', 'ADMIN'));

CREATE INDEX "User_systemRole_idx" ON "User"("systemRole");
