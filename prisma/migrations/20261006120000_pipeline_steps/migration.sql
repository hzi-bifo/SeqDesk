-- Pipelines as recipe steps (explore.pipeline-steps): a step kind, a pipeline step's settings on its revision, the
-- pipeline run a step run started or reused, the reuse cache, lab presets and install requests. Additive only:
-- every statement can run again on a database that already has it.
ALTER TABLE "ExploreAnalysis" ADD COLUMN IF NOT EXISTS "stepKind" TEXT NOT NULL DEFAULT 'code';
ALTER TABLE "ExploreAnalysisRevision" ADD COLUMN IF NOT EXISTS "pipeline" JSONB;
ALTER TABLE "ExploreAnalysisRun" ADD COLUMN IF NOT EXISTS "pipelineRunId" TEXT;
CREATE INDEX IF NOT EXISTS "ExploreAnalysisRun_pipelineRunId_idx" ON "ExploreAnalysisRun"("pipelineRunId");

CREATE TABLE IF NOT EXISTS "ExplorePipelineCache" (
    "id" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "pipelineRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExplorePipelineCache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ExplorePipelineCache_targetKey_pipelineId_version_inputHash_key" ON "ExplorePipelineCache"("targetKey", "pipelineId", "version", "inputHash");
CREATE INDEX IF NOT EXISTS "ExplorePipelineCache_pipelineRunId_idx" ON "ExplorePipelineCache"("pipelineRunId");

CREATE TABLE IF NOT EXISTS "ExplorePipelinePreset" (
    "id" TEXT NOT NULL,
    "labKey" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "versions" JSONB NOT NULL DEFAULT '[]',
    "params" JSONB NOT NULL DEFAULT '{}',
    "name" TEXT NOT NULL,
    "note" TEXT,
    "authorId" TEXT NOT NULL,
    "authorMemberId" TEXT,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "ExplorePipelinePreset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ExplorePipelinePreset_labKey_pipelineId_idx" ON "ExplorePipelinePreset"("labKey", "pipelineId");

CREATE TABLE IF NOT EXISTS "ExplorePipelineInstallRequest" (
    "id" TEXT NOT NULL,
    "labKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'install',
    "pipelineId" TEXT,
    "version" TEXT,
    "text" TEXT,
    "reason" TEXT,
    "targetKey" TEXT,
    "flowId" TEXT,
    "analysisId" TEXT,
    "stepPosition" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedByMemberId" TEXT,
    "requestedByName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExplorePipelineInstallRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ExplorePipelineInstallRequest_labKey_status_createdAt_idx" ON "ExplorePipelineInstallRequest"("labKey", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ExplorePipelineInstallRequest_status_createdAt_idx" ON "ExplorePipelineInstallRequest"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "ExplorePipelineInstallRequest_pipelineId_idx" ON "ExplorePipelineInstallRequest"("pipelineId");
