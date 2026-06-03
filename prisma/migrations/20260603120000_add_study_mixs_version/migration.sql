-- Record the MIxS checklist registry version a study was created against, so
-- studies stay pinned to the checklist definitions they were authored with
-- while new studies use the latest synced version. Nullable: legacy studies
-- predate version tracking and fall back to the active config.
ALTER TABLE "Study" ADD COLUMN "mixsVersion" INTEGER;
