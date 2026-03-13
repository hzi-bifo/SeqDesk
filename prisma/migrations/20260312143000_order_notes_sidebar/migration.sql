ALTER TABLE "Order"
ADD COLUMN "notes" TEXT,
ADD COLUMN "notesEditedAt" TIMESTAMP(3),
ADD COLUMN "notesEditedById" TEXT;

ALTER TABLE "Order"
ADD CONSTRAINT "Order_notesEditedById_fkey"
FOREIGN KEY ("notesEditedById") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "Order_notesEditedById_idx" ON "Order"("notesEditedById");
