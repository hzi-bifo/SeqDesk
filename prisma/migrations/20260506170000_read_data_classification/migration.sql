-- Add read data classification and active-read tracking.
ALTER TABLE "Read" ADD COLUMN "dataClass" TEXT NOT NULL DEFAULT 'cleaned';
ALTER TABLE "Read" ADD COLUMN "dataClassSource" TEXT NOT NULL DEFAULT 'legacy_assumed_cleaned';
ALTER TABLE "Read" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Read" ADD COLUMN "supersededByReadId" TEXT;
ALTER TABLE "Read" ADD COLUMN "classifiedAt" TIMESTAMP(3);
ALTER TABLE "Read" ADD COLUMN "classifiedById" TEXT;
ALTER TABLE "Read" ADD COLUMN "classificationNote" TEXT;

-- Existing linked reads are assumed to be cleaned. If a sample has more than
-- one read row, keep the oldest linked row active and preserve the rest as
-- inactive provenance so the partial unique index can be created safely.
WITH ranked_reads AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "sampleId"
      ORDER BY
        CASE WHEN "file1" IS NOT NULL OR "file2" IS NOT NULL THEN 0 ELSE 1 END,
        "id" ASC
    ) AS read_rank
  FROM "Read"
)
UPDATE "Read"
SET "isActive" = ranked_reads.read_rank = 1
FROM ranked_reads
WHERE "Read"."id" = ranked_reads."id";

CREATE UNIQUE INDEX "Read_one_active_per_sample"
  ON "Read"("sampleId")
  WHERE "isActive" = true;

CREATE INDEX "Read_sampleId_isActive_idx" ON "Read"("sampleId", "isActive");
CREATE INDEX "Read_dataClass_idx" ON "Read"("dataClass");
CREATE INDEX "Read_supersededByReadId_idx" ON "Read"("supersededByReadId");
