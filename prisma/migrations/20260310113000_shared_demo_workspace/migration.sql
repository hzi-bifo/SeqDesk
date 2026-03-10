-- Add a facility-demo persona to each disposable demo workspace.
ALTER TABLE "DemoWorkspace"
ADD COLUMN "adminUserId" TEXT;

CREATE UNIQUE INDEX "DemoWorkspace_adminUserId_key"
ON "DemoWorkspace"("adminUserId");

ALTER TABLE "DemoWorkspace"
ADD CONSTRAINT "DemoWorkspace_adminUserId_fkey"
FOREIGN KEY ("adminUserId") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
