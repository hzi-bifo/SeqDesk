-- Track order-level publication of sequencer-origin delivery files to the order owner.
ALTER TABLE "Order" ADD COLUMN "sequencingFilesPublishedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "sequencingFilesPublishedById" TEXT;

CREATE INDEX "Order_sequencingFilesPublishedById_idx"
  ON "Order"("sequencingFilesPublishedById");

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_sequencingFilesPublishedById_fkey"
  FOREIGN KEY ("sequencingFilesPublishedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
