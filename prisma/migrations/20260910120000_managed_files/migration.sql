CREATE TABLE "ManagedFile" (
    "id" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManagedFile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ManagedFile_storagePath_key" ON "ManagedFile"("storagePath");
CREATE INDEX "ManagedFile_targetKey_createdAt_idx" ON "ManagedFile"("targetKey", "createdAt");

CREATE TABLE "ExploreReportFile" (
    "reportId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExploreReportFile_pkey" PRIMARY KEY ("reportId", "fileId")
);
CREATE INDEX "ExploreReportFile_fileId_idx" ON "ExploreReportFile"("fileId");
ALTER TABLE "ExploreReportFile" ADD CONSTRAINT "ExploreReportFile_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ExploreReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExploreReportFile" ADD CONSTRAINT "ExploreReportFile_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "ManagedFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExploreDataset" ADD COLUMN "sourceFileId" TEXT;
ALTER TABLE "ExploreDataset" ADD CONSTRAINT "ExploreDataset_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ManagedFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExploreAnalysisRevision" ADD COLUMN "fileInputs" TEXT NOT NULL DEFAULT '[]';
