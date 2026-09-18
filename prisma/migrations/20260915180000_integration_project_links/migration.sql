CREATE TABLE IF NOT EXISTS "IntegrationProjectLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "authority" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "targetKind" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationProjectLink_context_target_key"
  ON "IntegrationProjectLink"("authority","workspaceId","projectId","targetKind","targetId");
