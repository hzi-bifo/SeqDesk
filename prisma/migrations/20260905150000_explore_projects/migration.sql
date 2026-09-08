-- CreateTable
CREATE TABLE "ExploreProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExploreProject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExploreProject_ownerId_idx" ON "ExploreProject"("ownerId");
