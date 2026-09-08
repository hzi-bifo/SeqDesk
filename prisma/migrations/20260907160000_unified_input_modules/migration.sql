ALTER TABLE "Order" ADD COLUMN "dataOrigin" TEXT NOT NULL DEFAULT 'facility';
ALTER TABLE "Order" ADD COLUMN "sourceMetadata" TEXT;
CREATE TABLE "StudySample" (
  "studyId" TEXT NOT NULL,
  "sampleId" TEXT NOT NULL,
  "groupLabel" TEXT,
  "role" TEXT NOT NULL DEFAULT 'unassigned',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudySample_pkey" PRIMARY KEY ("studyId", "sampleId"),
  CONSTRAINT "StudySample_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StudySample_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StudySample_role_check" CHECK ("role" IN ('unassigned', 'case', 'control', 'reference'))
);
CREATE INDEX "StudySample_sampleId_idx" ON "StudySample"("sampleId");
INSERT INTO "StudySample" ("studyId", "sampleId") SELECT "studyId", "id" FROM "Sample" WHERE "studyId" IS NOT NULL;
