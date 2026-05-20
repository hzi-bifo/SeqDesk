-- Add package output metadata to artifacts.
ALTER TABLE "PipelineArtifact" ADD COLUMN "outputId" TEXT;

-- Track the explicitly selected final completed run per pipeline and study/order target.
CREATE TABLE "PipelineResultSelection" (
  "id" TEXT NOT NULL,
  "pipelineId" TEXT NOT NULL,
  "targetKey" TEXT NOT NULL,
  "studyId" TEXT,
  "orderId" TEXT,
  "selectedRunId" TEXT NOT NULL,
  "selectedById" TEXT,
  "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PipelineResultSelection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PipelineResultSelection_pipelineId_targetKey_key"
  ON "PipelineResultSelection"("pipelineId", "targetKey");

CREATE UNIQUE INDEX "PipelineResultSelection_selectedRunId_key"
  ON "PipelineResultSelection"("selectedRunId");

CREATE INDEX "PipelineArtifact_outputId_idx" ON "PipelineArtifact"("outputId");
CREATE INDEX "PipelineResultSelection_studyId_idx" ON "PipelineResultSelection"("studyId");
CREATE INDEX "PipelineResultSelection_orderId_idx" ON "PipelineResultSelection"("orderId");
CREATE INDEX "PipelineResultSelection_selectedById_idx" ON "PipelineResultSelection"("selectedById");

ALTER TABLE "PipelineResultSelection"
  ADD CONSTRAINT "PipelineResultSelection_selectedRunId_fkey"
  FOREIGN KEY ("selectedRunId") REFERENCES "PipelineRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PipelineResultSelection"
  ADD CONSTRAINT "PipelineResultSelection_selectedById_fkey"
  FOREIGN KEY ("selectedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PipelineResultSelection"
  ADD CONSTRAINT "PipelineResultSelection_studyId_fkey"
  FOREIGN KEY ("studyId") REFERENCES "Study"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PipelineResultSelection"
  ADD CONSTRAINT "PipelineResultSelection_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
