-- Housekeeping: when a numbered run's outputs were pruned (the run record, manifest and
-- checksums stay), and a queue of file removals done in the background after a delete or a
-- prune. Additive only.
ALTER TABLE "ExploreFlowRun" ADD COLUMN IF NOT EXISTS "outputsPrunedAt" TIMESTAMP(3);
CREATE TABLE IF NOT EXISTS "ExploreCleanupJob" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "entries" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),
    CONSTRAINT "ExploreCleanupJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ExploreCleanupJob_status_createdAt_idx" ON "ExploreCleanupJob"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "ExploreCleanupJob_kind_createdAt_idx" ON "ExploreCleanupJob"("kind", "createdAt");
