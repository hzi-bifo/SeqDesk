import Link from "next/link";
import { Activity } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { WorkbenchEmptyPanel, WorkbenchPageHeader } from "@/components/workbench/WorkbenchPageShell";

export default function WorkbenchRunsPage() {
  return (
    <PageContainer>
      <WorkbenchPageHeader
        title="Runs"
        description="Active and completed Workbench pipeline runs for the selected workspace."
        icon={Activity}
      />

      <div className="space-y-4">
        <WorkbenchEmptyPanel
          title="No Workbench runs yet"
          description="Workspace-scoped runs will appear here. Current order and study pipeline runs remain available in the existing Analysis area during migration."
          icon={Activity}
          columns={["Run", "Pipeline", "State", "Started"]}
        />
        <Link
          href="/analysis"
          className="inline-flex items-center rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary/50"
        >
          View current Analysis runs
        </Link>
      </div>
    </PageContainer>
  );
}
