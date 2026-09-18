-- Notes on uploaded files: a description, tags and a sensitivity tier that
-- tables read from the file inherit, plus removal from the study. Removed
-- files keep their bytes and existing runs for provenance; they leave the
-- list and cannot be bound to new steps.
ALTER TABLE "ManagedFile" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "ManagedFile" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ManagedFile" ADD COLUMN IF NOT EXISTS "sensitivity" TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE "ManagedFile" ADD COLUMN IF NOT EXISTS "removedAt" TIMESTAMP(3);
ALTER TABLE "ManagedFile" ADD COLUMN IF NOT EXISTS "removedById" TEXT;
