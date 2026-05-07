CREATE TABLE "BackgroundWorkerProcess" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "pid" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedById" TEXT,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "stoppedAt" TIMESTAMP(3),
  "exitCode" INTEGER,
  "logPath" TEXT NOT NULL,
  "lastErrorMsg" TEXT,

  CONSTRAINT "BackgroundWorkerProcess_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BackgroundWorkerProcess_name_status_idx"
ON "BackgroundWorkerProcess"("name", "status");

CREATE INDEX "BackgroundWorkerProcess_name_startedAt_idx"
ON "BackgroundWorkerProcess"("name", "startedAt");

ALTER TABLE "BackgroundWorkerProcess"
ADD CONSTRAINT "BackgroundWorkerProcess_startedById_fkey"
FOREIGN KEY ("startedById") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
