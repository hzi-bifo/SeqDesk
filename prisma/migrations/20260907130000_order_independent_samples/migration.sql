-- Imported scientific samples belong to a study without a facility order.
ALTER TABLE "Sample" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_requires_order_or_study"
  CHECK ("orderId" IS NOT NULL OR "studyId" IS NOT NULL);
