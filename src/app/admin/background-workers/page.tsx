"use client";

import { PageContainer } from "@/components/layout/PageContainer";
import { BackgroundWorkersPanel } from "@/components/admin/BackgroundWorkersPanel";
import { Zap } from "lucide-react";

export default function BackgroundWorkersAdminPage() {
  return (
    <PageContainer>
      <div className="mb-6 flex items-start gap-3">
        <Zap className="h-6 w-6 text-primary mt-1" />
        <div>
          <h1 className="text-2xl font-semibold">Background workers</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Long-running daemons that the app depends on for live ingest and pipeline status updates. Start
            and stop them here so you don&apos;t need a separate terminal for normal use. Production
            deployments behind PM2 or systemd should leave these stopped and let the OS supervisor manage them.
          </p>
        </div>
      </div>

      <BackgroundWorkersPanel />
    </PageContainer>
  );
}
