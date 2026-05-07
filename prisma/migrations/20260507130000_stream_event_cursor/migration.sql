ALTER TABLE "StreamRunEvent"
ADD COLUMN "seq" SERIAL NOT NULL;

CREATE INDEX "StreamRunEvent_streamRunId_seq_idx"
ON "StreamRunEvent"("streamRunId", "seq");
