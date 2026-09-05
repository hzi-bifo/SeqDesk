-- AlterTable
ALTER TABLE "ExploreAnalysis" ADD COLUMN "reportId" TEXT;

-- CreateIndex
CREATE INDEX "ExploreAnalysis_reportId_idx" ON "ExploreAnalysis"("reportId");

-- AddForeignKey
ALTER TABLE "ExploreAnalysis" ADD CONSTRAINT "ExploreAnalysis_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ExploreReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every scope that has analyses but no report gets one, so existing work stays visible.
INSERT INTO "ExploreReport" ("id", "targetKey", "title", "blocks", "createdById", "createdAt", "updatedAt")
SELECT 'rep_' || substr(md5(random()::text || a."targetKey"), 1, 20), a."targetKey", 'Report 1', '[]'::jsonb, a."createdById", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON ("targetKey") "targetKey", "createdById"
  FROM "ExploreAnalysis"
  ORDER BY "targetKey", "createdAt" ASC
) a
WHERE NOT EXISTS (SELECT 1 FROM "ExploreReport" r WHERE r."targetKey" = a."targetKey");

-- Existing analyses become steps of the oldest report of their scope.
UPDATE "ExploreAnalysis" a
SET "reportId" = r."id"
FROM (
  SELECT DISTINCT ON ("targetKey") "id", "targetKey"
  FROM "ExploreReport"
  ORDER BY "targetKey", "createdAt" ASC
) r
WHERE a."reportId" IS NULL AND a."targetKey" = r."targetKey";
