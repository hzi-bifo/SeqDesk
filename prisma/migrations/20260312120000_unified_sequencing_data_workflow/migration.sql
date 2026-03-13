ALTER TABLE "Sample"
ADD COLUMN "facilityStatus" TEXT NOT NULL DEFAULT 'WAITING',
ADD COLUMN "facilityStatusUpdatedAt" TIMESTAMP(3);

UPDATE "Sample"
SET
  "facilityStatus" = 'SEQUENCED',
  "facilityStatusUpdatedAt" = NOW()
WHERE EXISTS (
  SELECT 1
  FROM "Read"
  WHERE "Read"."sampleId" = "Sample"."id"
    AND ("Read"."file1" IS NOT NULL OR "Read"."file2" IS NOT NULL)
);

CREATE TABLE "SequencingArtifact" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sampleId" TEXT,
  "sequencingRunId" TEXT,
  "stage" TEXT NOT NULL,
  "artifactType" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "visibility" TEXT NOT NULL DEFAULT 'facility',
  "path" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "size" BIGINT,
  "checksum" TEXT,
  "mimeType" TEXT,
  "metadata" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SequencingArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SequencingUpload" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sampleId" TEXT,
  "targetKind" TEXT NOT NULL,
  "targetRole" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "tempPath" TEXT NOT NULL,
  "finalPath" TEXT,
  "expectedSize" BIGINT NOT NULL,
  "receivedSize" BIGINT NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "checksumProvided" TEXT,
  "checksumComputed" TEXT,
  "mimeType" TEXT,
  "metadata" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SequencingUpload_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SequencingArtifact_orderId_stage_idx"
ON "SequencingArtifact"("orderId", "stage");

CREATE INDEX "SequencingArtifact_sampleId_stage_idx"
ON "SequencingArtifact"("sampleId", "stage");

CREATE INDEX "SequencingArtifact_sequencingRunId_idx"
ON "SequencingArtifact"("sequencingRunId");

CREATE INDEX "SequencingUpload_orderId_status_idx"
ON "SequencingUpload"("orderId", "status");

CREATE INDEX "SequencingUpload_sampleId_status_idx"
ON "SequencingUpload"("sampleId", "status");

ALTER TABLE "SequencingArtifact"
ADD CONSTRAINT "SequencingArtifact_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SequencingArtifact"
ADD CONSTRAINT "SequencingArtifact_sampleId_fkey"
FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SequencingArtifact"
ADD CONSTRAINT "SequencingArtifact_sequencingRunId_fkey"
FOREIGN KEY ("sequencingRunId") REFERENCES "SequencingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SequencingArtifact"
ADD CONSTRAINT "SequencingArtifact_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SequencingUpload"
ADD CONSTRAINT "SequencingUpload_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SequencingUpload"
ADD CONSTRAINT "SequencingUpload_sampleId_fkey"
FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SequencingUpload"
ADD CONSTRAINT "SequencingUpload_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
