-- Per-step environments: a step's extra conda packages and the derived environments built from them. Additive only.
ALTER TABLE "ExploreAnalysis" ADD COLUMN IF NOT EXISTS "packages" JSONB;
ALTER TABLE "ExploreEnvironment" ADD COLUMN IF NOT EXISTS "baseName" TEXT,
ADD COLUMN IF NOT EXISTS "baseSpecHash" TEXT,
ADD COLUMN IF NOT EXISTS "packages" JSONB,
ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMP(3);
ALTER TABLE "ExploreFlowRun" ADD COLUMN IF NOT EXISTS "preparing" JSONB;
