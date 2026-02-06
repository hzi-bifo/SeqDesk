"use client";

import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import {
  HardDrive,
  Settings2,
  ArrowRight,
  Server,
} from "lucide-react";
import { InfrastructureSetupStatus } from "@/components/admin/infrastructure/InfrastructureSetupStatus";

export default function InfrastructureOverviewPage() {
  return (
    <PageContainer>
      <div className="space-y-8">
        <div className="mb-4">
          <h1 className="text-xl font-semibold">Infrastructure</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure data storage and runtime prerequisites for imports and pipeline execution
          </p>
        </div>

        <InfrastructureSetupStatus />

        <div className="grid gap-4 lg:grid-cols-2">
          <GlassCard className="p-6">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                <HardDrive className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1 space-y-2">
                <h2 className="text-base font-semibold">Data Storage</h2>
                <p className="text-sm text-muted-foreground">
                  Set the sequencing data directory and file extension matching used by the importer.
                </p>
                <Button asChild variant="outline" size="sm" className="bg-white">
                  <Link href="/admin/data-storage">
                    Open Data Storage
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-6">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                <Settings2 className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1 space-y-2">
                <h2 className="text-base font-semibold">Pipeline Runtime</h2>
                <p className="text-sm text-muted-foreground">
                  Configure scheduler, conda path, run directory, and webhook diagnostics for Nextflow runs.
                </p>
                <Button asChild variant="outline" size="sm" className="bg-white">
                  <Link href="/admin/pipeline-runtime">
                    Open Pipeline Runtime
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              </div>
            </div>
          </GlassCard>
        </div>

        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
          <Server className="h-4 w-4" />
          Use Data Storage and Pipeline Runtime pages for configuration changes. This overview is for status and navigation.
        </div>
      </div>
    </PageContainer>
  );
}

