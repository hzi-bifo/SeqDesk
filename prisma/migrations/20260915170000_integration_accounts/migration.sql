CREATE TABLE IF NOT EXISTS "IntegrationAccount" (
  "id" TEXT NOT NULL,
  "authority" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "IntegrationAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationAccount_authority_workspaceId_memberId_key"
  ON "IntegrationAccount"("authority", "workspaceId", "memberId");
