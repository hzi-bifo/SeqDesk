-- Create saved Workbench analysis canvases.
CREATE TABLE "WorkbenchAnalysis" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Untitled analysis',
    "description" TEXT,
    "canvas" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkbenchAnalysis_pkey" PRIMARY KEY ("id")
);

-- Link import jobs back to the source node that launched them.
ALTER TABLE "WorkbenchImportJob"
ADD COLUMN "analysisId" TEXT,
ADD COLUMN "analysisNodeId" TEXT;

CREATE INDEX "WorkbenchAnalysis_workspaceId_updatedAt_idx"
ON "WorkbenchAnalysis"("workspaceId", "updatedAt");

CREATE INDEX "WorkbenchAnalysis_workspaceId_isDefault_idx"
ON "WorkbenchAnalysis"("workspaceId", "isDefault");

CREATE INDEX "WorkbenchImportJob_analysisId_idx"
ON "WorkbenchImportJob"("analysisId");

ALTER TABLE "WorkbenchAnalysis"
ADD CONSTRAINT "WorkbenchAnalysis_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "WorkbenchWorkspace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkbenchImportJob"
ADD CONSTRAINT "WorkbenchImportJob_analysisId_fkey"
FOREIGN KEY ("analysisId") REFERENCES "WorkbenchAnalysis"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
