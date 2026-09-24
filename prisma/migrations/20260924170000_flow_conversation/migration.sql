-- The shared conversation of a flow (sheet 46). Additive only.
ALTER TABLE "ExploreFlow" ADD COLUMN IF NOT EXISTS "conversationVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ExploreAnalysis" ADD COLUMN IF NOT EXISTS "proposedByTurnId" TEXT;
ALTER TABLE "ExploreStepProposal" ADD COLUMN IF NOT EXISTS "proposedByTurnId" TEXT,
ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "revisedByTurnId" TEXT,
ADD COLUMN IF NOT EXISTS "history" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS "ExploreFlowTurn" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "authorKind" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorMemberId" TEXT,
    "authorName" TEXT,
    "requestedByMemberId" TEXT,
    "stepIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "text" TEXT,
    "data" JSONB,
    "model" TEXT,
    "inputsLabel" TEXT,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExploreFlowTurn_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ExploreFlowTurn_flowId_seq_key" ON "ExploreFlowTurn"("flowId", "seq");

CREATE TABLE IF NOT EXISTS "ExploreFlowQuestion" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "stepId" TEXT,
    "text" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "answeredByUserId" TEXT,
    "answeredByMemberId" TEXT,
    "answeredAt" TIMESTAMP(3),
    "answerTurnId" TEXT,
    "answerOptionId" TEXT,
    "answerText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExploreFlowQuestion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ExploreFlowQuestion_turnId_key" ON "ExploreFlowQuestion"("turnId");
CREATE INDEX IF NOT EXISTS "ExploreFlowQuestion_flowId_idx" ON "ExploreFlowQuestion"("flowId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExploreFlowTurn_flowId_fkey') THEN
    ALTER TABLE "ExploreFlowTurn" ADD CONSTRAINT "ExploreFlowTurn_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "ExploreFlow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExploreFlowQuestion_flowId_fkey') THEN
    ALTER TABLE "ExploreFlowQuestion" ADD CONSTRAINT "ExploreFlowQuestion_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "ExploreFlow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
