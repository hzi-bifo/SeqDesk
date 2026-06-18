-- Per-study questionnaire schema for the `dynamic-studies` module. Additive,
-- 1:1 with Study (mirrors Sampleset's 1:1 with Order). When no row exists for a
-- study, loaders fall back to the global study form in SiteSettings.

-- CreateTable
CREATE TABLE "StudyFormConfig" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "fields" TEXT NOT NULL,
    "groups" TEXT NOT NULL,
    "defaultsVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyFormConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudyFormConfig_studyId_key" ON "StudyFormConfig"("studyId");

-- AddForeignKey
ALTER TABLE "StudyFormConfig" ADD CONSTRAINT "StudyFormConfig_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE CASCADE ON UPDATE CASCADE;
