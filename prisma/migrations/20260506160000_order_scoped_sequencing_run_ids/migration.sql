-- Allow facilities to reuse sequencer run labels across different orders.
DROP INDEX IF EXISTS "SequencingRun_runId_key";

CREATE UNIQUE INDEX "SequencingRun_orderId_runId_key"
ON "SequencingRun"("orderId", "runId");
