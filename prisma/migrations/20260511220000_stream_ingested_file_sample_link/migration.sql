-- AlterTable: add sampleId column to StreamIngestedFile
ALTER TABLE "StreamIngestedFile" ADD COLUMN "sampleId" TEXT;

-- CreateIndex: per-sample chronological lookup of stream-ingested files
CREATE INDEX "StreamIngestedFile_sampleId_ingestedAt_idx" ON "StreamIngestedFile"("sampleId", "ingestedAt");

-- AddForeignKey: SetNull on sample delete so partial-run data isn't lost
ALTER TABLE "StreamIngestedFile" ADD CONSTRAINT "StreamIngestedFile_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE SET NULL ON UPDATE CASCADE;
