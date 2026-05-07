ALTER TABLE "StreamRun"
ADD COLUMN "monitorId" TEXT,
ADD COLUMN "heartbeatAt" TIMESTAMP(3);

CREATE INDEX "StreamRun_status_heartbeatAt_idx"
ON "StreamRun"("status", "heartbeatAt");
