-- CreateTable
CREATE TABLE "WorkbenchWorkspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Private Workbench',
    "ownerId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkbenchWorkspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkbenchDataset" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceMetadata" TEXT,
    "storagePath" TEXT,
    "sizeBytes" BIGINT,
    "checksumSha256" TEXT,
    "genomeCount" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkbenchDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkbenchWorkspaceDataset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "createdByImportJobId" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkbenchWorkspaceDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkbenchImportJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "phase" TEXT,
    "request" TEXT NOT NULL,
    "preview" TEXT,
    "progress" INTEGER,
    "logPath" TEXT,
    "targetPath" TEXT,
    "error" TEXT,
    "createdById" TEXT NOT NULL,
    "resultDatasetId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkbenchImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkbenchWorkspace_ownerId_key" ON "WorkbenchWorkspace"("ownerId");

-- CreateIndex
CREATE INDEX "WorkbenchWorkspace_ownerId_idx" ON "WorkbenchWorkspace"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkbenchDataset_cacheKey_key" ON "WorkbenchDataset"("cacheKey");

-- CreateIndex
CREATE INDEX "WorkbenchDataset_providerId_idx" ON "WorkbenchDataset"("providerId");

-- CreateIndex
CREATE INDEX "WorkbenchDataset_status_idx" ON "WorkbenchDataset"("status");

-- CreateIndex
CREATE INDEX "WorkbenchWorkspaceDataset_datasetId_idx" ON "WorkbenchWorkspaceDataset"("datasetId");

-- CreateIndex
CREATE INDEX "WorkbenchWorkspaceDataset_createdByImportJobId_idx" ON "WorkbenchWorkspaceDataset"("createdByImportJobId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkbenchWorkspaceDataset_workspaceId_datasetId_key" ON "WorkbenchWorkspaceDataset"("workspaceId", "datasetId");

-- CreateIndex
CREATE INDEX "WorkbenchImportJob_workspaceId_createdAt_idx" ON "WorkbenchImportJob"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkbenchImportJob_providerId_idx" ON "WorkbenchImportJob"("providerId");

-- CreateIndex
CREATE INDEX "WorkbenchImportJob_status_idx" ON "WorkbenchImportJob"("status");

-- CreateIndex
CREATE INDEX "WorkbenchImportJob_createdById_idx" ON "WorkbenchImportJob"("createdById");

-- CreateIndex
CREATE INDEX "WorkbenchImportJob_resultDatasetId_idx" ON "WorkbenchImportJob"("resultDatasetId");

-- AddForeignKey
ALTER TABLE "WorkbenchWorkspace" ADD CONSTRAINT "WorkbenchWorkspace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbenchWorkspaceDataset" ADD CONSTRAINT "WorkbenchWorkspaceDataset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "WorkbenchWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbenchWorkspaceDataset" ADD CONSTRAINT "WorkbenchWorkspaceDataset_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "WorkbenchDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbenchWorkspaceDataset" ADD CONSTRAINT "WorkbenchWorkspaceDataset_createdByImportJobId_fkey" FOREIGN KEY ("createdByImportJobId") REFERENCES "WorkbenchImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbenchImportJob" ADD CONSTRAINT "WorkbenchImportJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "WorkbenchWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbenchImportJob" ADD CONSTRAINT "WorkbenchImportJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbenchImportJob" ADD CONSTRAINT "WorkbenchImportJob_resultDatasetId_fkey" FOREIGN KEY ("resultDatasetId") REFERENCES "WorkbenchDataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
