ALTER TABLE "User"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "deactivatedAt" TIMESTAMP(3);

CREATE INDEX "User_systemRole_isActive_idx"
  ON "User"("systemRole", "isActive");
