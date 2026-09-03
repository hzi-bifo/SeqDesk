"use client";

import { signOut } from "next-auth/react";
import { Clock3, LogOut, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DeploymentProfileId } from "@/lib/deployment-profile";

const PROFILE_LABELS: Record<DeploymentProfileId, string> = {
  "sequencing-center": "sequencing center",
  "shared-lab": "shared lab",
  "research-workbench": "research workbench",
};

export function OperationalSetupPending({
  profile,
  completedCount,
  totalCount,
}: {
  profile: DeploymentProfileId;
  completedCount: number;
  totalCount: number;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
            <Clock3 className="h-5 w-5" />
          </div>
          <CardTitle>Your administrator is finishing setup</CardTitle>
          <CardDescription>
            This {PROFILE_LABELS[profile]} installation is available, but its operational
            checklist is not complete yet. No scientific work can be started until an
            administrator confirms the remaining setup responsibilities.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Setup progress: {completedCount} of {totalCount} checks complete.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => window.location.reload()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Check again
            </Button>
            <Button variant="ghost" onClick={() => void signOut({ callbackUrl: "/login" })}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
