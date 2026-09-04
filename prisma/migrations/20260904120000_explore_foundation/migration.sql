-- CreateTable
CREATE TABLE "ExploreDataset" (
    "id" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tableKind" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sensitivity" TEXT NOT NULL DEFAULT 'standard',
    "roles" TEXT,
    "sourceConfig" TEXT,
    "currentVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExploreDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExploreDatasetVersion" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "schema" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "provenance" TEXT NOT NULL,
    "storagePath" TEXT,
    "buildSource" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExploreDatasetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExploreDatasetRow" (
    "id" SERIAL NOT NULL,
    "versionId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "sampleId" TEXT,
    "subjectId" TEXT,
    "key" TEXT,
    "data" JSONB NOT NULL,

    CONSTRAINT "ExploreDatasetRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExploreDatasetEdit" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "value" TEXT,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "ExploreDatasetEdit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExploreCurationList" (
    "id" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "site" TEXT,
    "tier" TEXT,
    "color" TEXT,
    "entries" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExploreCurationList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExploreEnvironment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "specHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'missing',
    "prefixPath" TEXT,
    "builtAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExploreEnvironment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExploreAnalysis" (
    "id" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kitId" TEXT,
    "language" TEXT NOT NULL,
    "environmentName" TEXT NOT NULL,
    "currentRevisionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExploreAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExploreAnalysisRevision" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "params" TEXT NOT NULL,
    "inputs" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorUserId" TEXT,
    "prompt" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExploreAnalysisRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExploreAnalysisRun" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "runNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "executionMode" TEXT,
    "runFolder" TEXT,
    "queueJobId" TEXT,
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "exitCode" INTEGER,
    "outputTail" TEXT,
    "errorTail" TEXT,
    "results" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExploreAnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExploreArtifact" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "size" BIGINT,
    "checksum" TEXT,
    "derivedDatasetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExploreArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExploreDataset_currentVersionId_key" ON "ExploreDataset"("currentVersionId");

-- CreateIndex
CREATE INDEX "ExploreDataset_targetKey_kind_idx" ON "ExploreDataset"("targetKey", "kind");

-- CreateIndex
CREATE INDEX "ExploreDataset_createdById_idx" ON "ExploreDataset"("createdById");

-- CreateIndex
CREATE INDEX "ExploreDatasetVersion_datasetId_contentHash_idx" ON "ExploreDatasetVersion"("datasetId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "ExploreDatasetVersion_datasetId_number_key" ON "ExploreDatasetVersion"("datasetId", "number");

-- CreateIndex
CREATE INDEX "ExploreDatasetRow_versionId_sampleId_idx" ON "ExploreDatasetRow"("versionId", "sampleId");

-- CreateIndex
CREATE INDEX "ExploreDatasetRow_versionId_subjectId_idx" ON "ExploreDatasetRow"("versionId", "subjectId");

-- CreateIndex
CREATE INDEX "ExploreDatasetRow_versionId_key_idx" ON "ExploreDatasetRow"("versionId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ExploreDatasetRow_versionId_rowIndex_key" ON "ExploreDatasetRow"("versionId", "rowIndex");

-- CreateIndex
CREATE INDEX "ExploreDatasetEdit_datasetId_createdAt_idx" ON "ExploreDatasetEdit"("datasetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExploreCurationList_targetKey_listId_key" ON "ExploreCurationList"("targetKey", "listId");

-- CreateIndex
CREATE UNIQUE INDEX "ExploreEnvironment_name_key" ON "ExploreEnvironment"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ExploreAnalysis_currentRevisionId_key" ON "ExploreAnalysis"("currentRevisionId");

-- CreateIndex
CREATE INDEX "ExploreAnalysis_targetKey_idx" ON "ExploreAnalysis"("targetKey");

-- CreateIndex
CREATE INDEX "ExploreAnalysis_createdById_idx" ON "ExploreAnalysis"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "ExploreAnalysisRevision_analysisId_number_key" ON "ExploreAnalysisRevision"("analysisId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ExploreAnalysisRun_runNumber_key" ON "ExploreAnalysisRun"("runNumber");

-- CreateIndex
CREATE INDEX "ExploreAnalysisRun_analysisId_createdAt_idx" ON "ExploreAnalysisRun"("analysisId", "createdAt");

-- CreateIndex
CREATE INDEX "ExploreAnalysisRun_status_idx" ON "ExploreAnalysisRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ExploreArtifact_runId_path_key" ON "ExploreArtifact"("runId", "path");

-- AddForeignKey
ALTER TABLE "ExploreDataset" ADD CONSTRAINT "ExploreDataset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExploreDatasetVersion" ADD CONSTRAINT "ExploreDatasetVersion_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "ExploreDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExploreDatasetRow" ADD CONSTRAINT "ExploreDatasetRow_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ExploreDatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExploreDatasetEdit" ADD CONSTRAINT "ExploreDatasetEdit_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "ExploreDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExploreAnalysis" ADD CONSTRAINT "ExploreAnalysis_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExploreAnalysisRevision" ADD CONSTRAINT "ExploreAnalysisRevision_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ExploreAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExploreAnalysisRun" ADD CONSTRAINT "ExploreAnalysisRun_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ExploreAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExploreAnalysisRun" ADD CONSTRAINT "ExploreAnalysisRun_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ExploreAnalysisRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExploreAnalysisRun" ADD CONSTRAINT "ExploreAnalysisRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExploreArtifact" ADD CONSTRAINT "ExploreArtifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ExploreAnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

