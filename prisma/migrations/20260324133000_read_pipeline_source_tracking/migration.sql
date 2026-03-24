-- AlterTable
ALTER TABLE "Read"
ADD COLUMN "pipelineRunId" TEXT,
ADD COLUMN "pipelineSources" TEXT;

-- AddForeignKey
ALTER TABLE "Read"
ADD CONSTRAINT "Read_pipelineRunId_fkey"
FOREIGN KEY ("pipelineRunId") REFERENCES "PipelineRun"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
