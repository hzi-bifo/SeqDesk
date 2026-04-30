ALTER TABLE "SequencingRun"
ADD COLUMN "orderId" TEXT;

CREATE TABLE "SequencingRunSample" (
  "id" TEXT NOT NULL,
  "sequencingRunId" TEXT NOT NULL,
  "sampleId" TEXT NOT NULL,
  "barcode" TEXT,
  "customFields" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SequencingRunSample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SequencingRun_orderId_idx"
ON "SequencingRun"("orderId");

CREATE INDEX "SequencingRun_runDate_idx"
ON "SequencingRun"("runDate");

CREATE UNIQUE INDEX "SequencingRunSample_sequencingRunId_sampleId_key"
ON "SequencingRunSample"("sequencingRunId", "sampleId");

CREATE UNIQUE INDEX "SequencingRunSample_sequencingRunId_barcode_key"
ON "SequencingRunSample"("sequencingRunId", "barcode");

CREATE INDEX "SequencingRunSample_sampleId_idx"
ON "SequencingRunSample"("sampleId");

ALTER TABLE "SequencingRun"
ADD CONSTRAINT "SequencingRun_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "SequencingRunSample"
ADD CONSTRAINT "SequencingRunSample_sequencingRunId_fkey"
FOREIGN KEY ("sequencingRunId") REFERENCES "SequencingRun"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "SequencingRunSample"
ADD CONSTRAINT "SequencingRunSample_sampleId_fkey"
FOREIGN KEY ("sampleId") REFERENCES "Sample"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
