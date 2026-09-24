CREATE TABLE IF NOT EXISTS "ExploreStepConversation" (
 "analysisId" TEXT NOT NULL REFERENCES "ExploreAnalysis"("id") ON DELETE CASCADE,
 "userId" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 0,
 "state" TEXT NOT NULL DEFAULT '{}', "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("analysisId", "userId")
);
ALTER TABLE "ExploreArtifact" ADD COLUMN IF NOT EXISTS "derivedVersionId" TEXT;
