-- Flow inputs: the Data tables an analysis reads, named by what they stand for (a template's
-- "counts", or a table attached from the recipe). Additive only.
CREATE TABLE IF NOT EXISTS "ExploreFlowInput" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "expects" TEXT,
    "check" JSONB,
    "datasetId" TEXT,
    "templateId" TEXT,
    "uses" JSONB,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExploreFlowInput_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ExploreFlowInput_flowId_key_key" ON "ExploreFlowInput"("flowId", "key");
