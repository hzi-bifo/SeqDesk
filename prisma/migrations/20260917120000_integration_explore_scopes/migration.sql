CREATE TABLE IF NOT EXISTS "IntegrationExploreScope" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "authority" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL DEFAULT '',
  "targetKey" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationExploreScope_scope_key"
  ON "IntegrationExploreScope"("authority","workspaceId","targetKey");
CREATE INDEX IF NOT EXISTS "IntegrationExploreScope_authority_workspaceId_projectId_idx"
  ON "IntegrationExploreScope"("authority","workspaceId","projectId");
