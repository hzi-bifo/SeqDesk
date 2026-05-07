CREATE TABLE "StreamRun" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "minknowRunId" TEXT,
  "flowCellId" TEXT,
  "deviceId" TEXT,
  "outputDir" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "totalBases" BIGINT NOT NULL DEFAULT 0,
  "totalReads" INTEGER NOT NULL DEFAULT 0,
  "barcodeMap" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "stoppedAt" TIMESTAMP(3),

  CONSTRAINT "StreamRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StreamRunEvent" (
  "id" TEXT NOT NULL,
  "streamRunId" TEXT NOT NULL,
  "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "kind" TEXT NOT NULL,
  "payload" TEXT,

  CONSTRAINT "StreamRunEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StreamRun_orderId_status_idx"
ON "StreamRun"("orderId", "status");

CREATE INDEX "StreamRunEvent_streamRunId_ts_idx"
ON "StreamRunEvent"("streamRunId", "ts");

ALTER TABLE "StreamRun"
ADD CONSTRAINT "StreamRun_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "StreamRunEvent"
ADD CONSTRAINT "StreamRunEvent_streamRunId_fkey"
FOREIGN KEY ("streamRunId") REFERENCES "StreamRun"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
