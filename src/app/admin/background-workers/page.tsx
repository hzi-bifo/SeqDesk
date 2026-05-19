"use client";

import { PageContainer } from "@/components/layout/PageContainer";
import { HelpBox } from "@/components/ui/help-box";
import { BackgroundWorkersPanel } from "@/components/admin/BackgroundWorkersPanel";
import { Zap, RefreshCw } from "lucide-react";

export default function BackgroundWorkersAdminPage() {
  return (
    <>
      <div className="sticky top-0 z-30 bg-card border-b border-border">
        <div className="flex min-h-12 flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <RefreshCw className="h-3 w-3" />
            Auto-refreshing every 5 seconds
          </div>
          <div className="text-xs text-muted-foreground">
            Worker actions are recorded with your admin account
          </div>
        </div>
      </div>

      <PageContainer>
        <div className="space-y-8">
          <div className="mb-4 mt-6">
            <h1 className="text-xl font-semibold">Background Workers</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Long-running daemons the app depends on for live ingest and pipeline status updates
            </p>
          </div>

          <HelpBox title="When to use this page">
            Start and stop background daemons here so you don&apos;t need a separate terminal for normal use.
            Pipeline monitor should run as one singleton process; weblog callbacks provide live Nextflow events,
            while the monitor recovers status from queue/trace state when callbacks are unavailable.
            Production deployments behind PM2 or systemd should leave these stopped and let the OS supervisor
            manage them &mdash; starting a worker here while a supervisor also runs one will result in two
            instances racing on the same database tables.
          </HelpBox>

          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
                <Zap className="h-4 w-4 text-muted-foreground" />
              </div>
              <h2 className="text-base font-semibold">Workers</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Status, recent log output, and start/stop controls for each registered daemon.
            </p>

            <BackgroundWorkersPanel />
          </div>
        </div>
      </PageContainer>
    </>
  );
}
