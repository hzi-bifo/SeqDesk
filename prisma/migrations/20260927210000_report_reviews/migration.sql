-- People's section checks and the version list of a report page, shared by every browser (additive).
CREATE TABLE IF NOT EXISTS "ExploreReportReview" (
    "reportId" TEXT NOT NULL,
    "checks" JSONB NOT NULL DEFAULT '{}',
    "versions" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExploreReportReview_pkey" PRIMARY KEY ("reportId")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExploreReportReview_reportId_fkey') THEN
    ALTER TABLE "ExploreReportReview" ADD CONSTRAINT "ExploreReportReview_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ExploreReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
