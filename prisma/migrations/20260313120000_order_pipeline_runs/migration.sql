-- AlterTable
ALTER TABLE "PipelineRun"
ADD COLUMN "targetType" TEXT NOT NULL DEFAULT 'study',
ADD COLUMN "orderId" TEXT;

-- CreateIndex
CREATE INDEX "PipelineRun_studyId_idx" ON "PipelineRun"("studyId");

-- CreateIndex
CREATE INDEX "PipelineRun_orderId_idx" ON "PipelineRun"("orderId");

-- CreateIndex
CREATE INDEX "PipelineRun_targetType_idx" ON "PipelineRun"("targetType");

-- AddForeignKey
ALTER TABLE "PipelineRun"
ADD CONSTRAINT "PipelineRun_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
