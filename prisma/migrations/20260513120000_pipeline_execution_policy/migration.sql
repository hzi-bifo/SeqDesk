-- Add per-run execution policy snapshot fields for local/SLURM launches.
ALTER TABLE "PipelineRun" ADD COLUMN "executionMode" TEXT;
ALTER TABLE "PipelineRun" ADD COLUMN "executionProfile" TEXT;
