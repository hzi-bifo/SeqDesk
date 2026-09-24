-- People's marks and Writer references that keep a flow's current run in place (additive).
CREATE TABLE IF NOT EXISTS "ExploreRunHold" (
    "id" TEXT NOT NULL,
    "flowRunId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "memberId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExploreRunHold_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ExploreRunHold_flowRunId_kind_key_key" ON "ExploreRunHold"("flowRunId", "kind", "key");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExploreRunHold_flowRunId_fkey') THEN
    ALTER TABLE "ExploreRunHold" ADD CONSTRAINT "ExploreRunHold_flowRunId_fkey" FOREIGN KEY ("flowRunId") REFERENCES "ExploreFlowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
