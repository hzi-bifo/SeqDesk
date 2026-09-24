-- Flow recipe redesign (FLOW-GAPS A1). Additive only: new columns carry
-- defaults, new tables stand alone, nothing existing is rewritten except the
-- code hash backfill below.

-- AlterTable
ALTER TABLE "ExploreAnalysis" ADD COLUMN IF NOT EXISTS "groupId" TEXT,
ADD COLUMN IF NOT EXISTS "laneKind" TEXT,
ADD COLUMN IF NOT EXISTS "laneLabel" TEXT,
ADD COLUMN IF NOT EXISTS "laneOf" TEXT,
ADD COLUMN IF NOT EXISTS "methodsSentence" JSONB,
ADD COLUMN IF NOT EXISTS "paramMeta" JSONB,
ADD COLUMN IF NOT EXISTS "position" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "purpose" TEXT;

-- AlterTable
ALTER TABLE "ExploreAnalysisRevision" ADD COLUMN IF NOT EXISTS "codeHash" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ExploreAnalysisRun" ADD COLUMN IF NOT EXISTS "durationMs" INTEGER,
ADD COLUMN IF NOT EXISTS "environmentDigest" TEXT,
ADD COLUMN IF NOT EXISTS "flowRunId" TEXT,
ADD COLUMN IF NOT EXISTS "inputPins" JSONB,
ADD COLUMN IF NOT EXISTS "reusedFromRunId" TEXT,
ADD COLUMN IF NOT EXISTS "stepLabel" TEXT,
ADD COLUMN IF NOT EXISTS "trial" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ExploreEnvironment" ADD COLUMN IF NOT EXISTS "languageVersion" TEXT,
ADD COLUMN IF NOT EXISTS "lockDigest" TEXT,
ADD COLUMN IF NOT EXISTS "lockSpecHash" TEXT;

-- AlterTable
ALTER TABLE "ExploreFlow" ADD COLUMN IF NOT EXISTS "createdByMemberId" TEXT,
ADD COLUMN IF NOT EXISTS "currentRunId" TEXT,
ADD COLUMN IF NOT EXISTS "headlineValue" TEXT,
ADD COLUMN IF NOT EXISTS "layout" JSONB,
ADD COLUMN IF NOT EXISTS "recipeRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "runCounter" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "trialCounter" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "IntegrationExploreScope" ADD COLUMN IF NOT EXISTS "ownerMemberId" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'lab';

-- AlterTable
ALTER TABLE "ManagedFile" ADD COLUMN IF NOT EXISTS "createdByMemberId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExploreFlowRevision" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "steps" JSONB NOT NULL,
    "message" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExploreFlowRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExploreFlowRun" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "number" INTEGER,
    "trialNumber" INTEGER,
    "kind" TEXT NOT NULL,
    "flowRevisionId" TEXT,
    "recipeRevision" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "startedById" TEXT NOT NULL,
    "startedByMemberId" TEXT,
    "startedByName" TEXT,
    "notifyOnFinish" BOOLEAN NOT NULL DEFAULT false,
    "stepCount" INTEGER NOT NULL DEFAULT 0,
    "doneCount" INTEGER NOT NULL DEFAULT 0,
    "currentAnalysisId" TEXT,
    "failedAnalysisId" TEXT,
    "failedStepLabel" TEXT,
    "failureWords" TEXT,
    "failureDetail" TEXT,
    "plan" JSONB NOT NULL,
    "inputs" JSONB NOT NULL DEFAULT '[]',
    "environment" JSONB,
    "summary" JSONB,
    "verification" JSONB,
    "trialSample" JSONB,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExploreFlowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExploreStepProposal" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "afterAnalysisId" TEXT,
    "laneOf" TEXT,
    "position" TEXT NOT NULL DEFAULT '',
    "canvas" JSONB,
    "purpose" TEXT NOT NULL DEFAULT '',
    "why" TEXT NOT NULL DEFAULT '',
    "assumes" JSONB NOT NULL DEFAULT '[]',
    "notChecked" JSONB NOT NULL DEFAULT '[]',
    "refusals" JSONB NOT NULL DEFAULT '[]',
    "inputs" JSONB NOT NULL DEFAULT '[]',
    "outputs" JSONB NOT NULL DEFAULT '[]',
    "code" TEXT,
    "language" TEXT NOT NULL DEFAULT 'python',
    "kitId" TEXT,
    "params" JSONB,
    "values" JSONB,
    "text" TEXT,
    "analysisId" TEXT,
    "glossId" TEXT,
    "flowRunId" TEXT,
    "goal" TEXT,
    "origin" JSONB,
    "requestedById" TEXT NOT NULL,
    "requestedByMemberId" TEXT,
    "activityId" TEXT,
    "acceptedById" TEXT,
    "acceptedAnalysisId" TEXT,
    "acceptedFindingId" TEXT,
    "discardReason" TEXT,
    "trialRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExploreStepProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExploreGloss" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "lineStart" INTEGER NOT NULL,
    "lineEnd" INTEGER NOT NULL,
    "regionHash" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pencil',
    "acceptedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "checkStatus" TEXT NOT NULL DEFAULT 'unchecked',
    "checkNotes" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExploreGloss_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExploreRunFinding" (
    "id" TEXT NOT NULL,
    "flowRunId" TEXT NOT NULL,
    "analysisId" TEXT,
    "text" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '[]',
    "caveats" JSONB NOT NULL DEFAULT '[]',
    "acceptedById" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExploreRunFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExploreCapsule" (
    "id" TEXT NOT NULL,
    "flowRunId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'building',
    "path" TEXT,
    "size" BIGINT,
    "sha256" TEXT,
    "contents" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verification" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExploreCapsule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExploreEventOutbox" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExploreEventOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExploreFlowRevision_flowId_number_key" ON "ExploreFlowRevision"("flowId", "number");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExploreFlowRun_requestId_key" ON "ExploreFlowRun"("requestId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExploreFlowRun_flowId_createdAt_idx" ON "ExploreFlowRun"("flowId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExploreFlowRun_status_idx" ON "ExploreFlowRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExploreFlowRun_flowId_number_key" ON "ExploreFlowRun"("flowId", "number");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExploreFlowRun_flowId_trialNumber_key" ON "ExploreFlowRun"("flowId", "trialNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExploreStepProposal_flowId_state_idx" ON "ExploreStepProposal"("flowId", "state");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExploreGloss_analysisId_regionHash_idx" ON "ExploreGloss"("analysisId", "regionHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExploreGloss_analysisId_revisionId_idx" ON "ExploreGloss"("analysisId", "revisionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExploreRunFinding_flowRunId_idx" ON "ExploreRunFinding"("flowRunId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExploreCapsule_flowRunId_artifactId_idx" ON "ExploreCapsule"("flowRunId", "artifactId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExploreEventOutbox_deliveredAt_failedAt_nextAttemptAt_idx" ON "ExploreEventOutbox"("deliveredAt", "failedAt", "nextAttemptAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExploreAnalysisRun_flowRunId_idx" ON "ExploreAnalysisRun"("flowRunId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExploreFlowRevision_flowId_fkey') THEN
    ALTER TABLE "ExploreFlowRevision" ADD CONSTRAINT "ExploreFlowRevision_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "ExploreFlow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExploreFlowRun_flowId_fkey') THEN
    ALTER TABLE "ExploreFlowRun" ADD CONSTRAINT "ExploreFlowRun_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "ExploreFlow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExploreStepProposal_flowId_fkey') THEN
    ALTER TABLE "ExploreStepProposal" ADD CONSTRAINT "ExploreStepProposal_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "ExploreFlow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExploreGloss_analysisId_fkey') THEN
    ALTER TABLE "ExploreGloss" ADD CONSTRAINT "ExploreGloss_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ExploreAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExploreRunFinding_flowRunId_fkey') THEN
    ALTER TABLE "ExploreRunFinding" ADD CONSTRAINT "ExploreRunFinding_flowRunId_fkey" FOREIGN KEY ("flowRunId") REFERENCES "ExploreFlowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExploreCapsule_flowRunId_fkey') THEN
    ALTER TABLE "ExploreCapsule" ADD CONSTRAINT "ExploreCapsule_flowRunId_fkey" FOREIGN KEY ("flowRunId") REFERENCES "ExploreFlowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExploreAnalysisRun_flowRunId_fkey') THEN
    ALTER TABLE "ExploreAnalysisRun" ADD CONSTRAINT "ExploreAnalysisRun_flowRunId_fkey" FOREIGN KEY ("flowRunId") REFERENCES "ExploreFlowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Code hashes for existing revisions (new ones are written by the app).
UPDATE "ExploreAnalysisRevision" SET "codeHash" = encode(sha256(convert_to("code", 'UTF8')), 'hex') WHERE "codeHash" = '';

-- One active run per flow, trials included, across processes and tabs.
CREATE UNIQUE INDEX IF NOT EXISTS "ExploreFlowRun_one_active_per_flow"
ON "ExploreFlowRun" ("flowId") WHERE "status" IN ('queued', 'running');
