-- CreateTable
CREATE TABLE "StreamIngestedFile" (
    "id" TEXT NOT NULL,
    "streamRunId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "barcode" TEXT,
    "size" INTEGER NOT NULL DEFAULT 0,
    "reads" INTEGER NOT NULL DEFAULT 0,
    "bases" BIGINT NOT NULL DEFAULT 0,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamIngestedFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StreamIngestedFile_streamRunId_filePath_key" ON "StreamIngestedFile"("streamRunId", "filePath");

-- CreateIndex
CREATE INDEX "StreamIngestedFile_streamRunId_ingestedAt_idx" ON "StreamIngestedFile"("streamRunId", "ingestedAt");

-- AddForeignKey
ALTER TABLE "StreamIngestedFile" ADD CONSTRAINT "StreamIngestedFile_streamRunId_fkey" FOREIGN KEY ("streamRunId") REFERENCES "StreamRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
