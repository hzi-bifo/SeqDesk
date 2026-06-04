-- Concurrency/idempotency: add DB-level uniqueness for pipeline-resolved outputs
-- so concurrent resolution (weblog workflow_complete + monitor/sync finalize)
-- cannot create duplicate artifacts/assemblies/bins.
--
-- Existing rows may already contain duplicates created before these constraints
-- existed, so each table is de-duplicated (keep the oldest row, drop the rest)
-- BEFORE the unique index is created. Everything runs in the single implicit
-- migration transaction, so a partial failure rolls back cleanly.

-- 1) PipelineArtifact: collapse duplicates on (pipelineRunId, path).
--    Rows with pipelineRunId IS NULL are never collapsed (NULLs are distinct).
DELETE FROM "PipelineArtifact" a
USING "PipelineArtifact" b
WHERE a."pipelineRunId" IS NOT NULL
  AND a."pipelineRunId" = b."pipelineRunId"
  AND a."path" = b."path"
  AND a."id" > b."id";

CREATE UNIQUE INDEX "PipelineArtifact_pipelineRunId_path_key"
  ON "PipelineArtifact" ("pipelineRunId", "path");

-- 2) Assembly: collapse duplicates on (createdByPipelineRunId, sampleId, assemblyFile).
DELETE FROM "Assembly" a
USING "Assembly" b
WHERE a."createdByPipelineRunId" IS NOT NULL
  AND a."assemblyFile" IS NOT NULL
  AND a."createdByPipelineRunId" = b."createdByPipelineRunId"
  AND a."sampleId" = b."sampleId"
  AND a."assemblyFile" = b."assemblyFile"
  AND a."id" > b."id";

CREATE UNIQUE INDEX "Assembly_createdByPipelineRunId_sampleId_assemblyFile_key"
  ON "Assembly" ("createdByPipelineRunId", "sampleId", "assemblyFile");

-- 3) Bin: collapse duplicates on (createdByPipelineRunId, sampleId, binFile).
DELETE FROM "Bin" a
USING "Bin" b
WHERE a."createdByPipelineRunId" IS NOT NULL
  AND a."binFile" IS NOT NULL
  AND a."createdByPipelineRunId" = b."createdByPipelineRunId"
  AND a."sampleId" = b."sampleId"
  AND a."binFile" = b."binFile"
  AND a."id" > b."id";

CREATE UNIQUE INDEX "Bin_createdByPipelineRunId_sampleId_binFile_key"
  ON "Bin" ("createdByPipelineRunId", "sampleId", "binFile");
