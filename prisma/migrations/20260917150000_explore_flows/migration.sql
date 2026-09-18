-- Flows: a canvas of analysis steps, independent of reports. Existing report
-- canvases become one flow each (same id, named after the report) so stored
-- layouts and links keep working.
CREATE TABLE IF NOT EXISTS "ExploreFlow" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "targetKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "ExploreFlow_targetKey_idx" ON "ExploreFlow"("targetKey");

ALTER TABLE "ExploreAnalysis" ADD COLUMN IF NOT EXISTS "flowId" TEXT;
CREATE INDEX IF NOT EXISTS "ExploreAnalysis_flowId_idx" ON "ExploreAnalysis"("flowId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExploreAnalysis_flowId_fkey') THEN
    ALTER TABLE "ExploreAnalysis" ADD CONSTRAINT "ExploreAnalysis_flowId_fkey"
      FOREIGN KEY ("flowId") REFERENCES "ExploreFlow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "ExploreFlow" ("id", "targetKey", "name", "description", "createdById", "createdAt", "updatedAt")
SELECT r."id", r."targetKey", r."title", NULL, r."createdById", r."createdAt", CURRENT_TIMESTAMP
FROM "ExploreReport" r
WHERE EXISTS (SELECT 1 FROM "ExploreAnalysis" a WHERE a."reportId" = r."id")
  AND NOT EXISTS (SELECT 1 FROM "ExploreFlow" f WHERE f."id" = r."id");
UPDATE "ExploreAnalysis" SET "flowId" = "reportId" WHERE "flowId" IS NULL AND "reportId" IS NOT NULL;
