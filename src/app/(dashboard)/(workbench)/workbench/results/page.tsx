import { FileText } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { WorkbenchEmptyPanel, WorkbenchPageHeader } from "@/components/workbench/WorkbenchPageShell";

export default function WorkbenchResultsPage() {
  return (
    <PageContainer>
      <WorkbenchPageHeader
        title="Results"
        description="Reports, output datasets, downloadable artifacts, and generated result metadata."
        icon={FileText}
      />

      <WorkbenchEmptyPanel
        title="No result artifacts yet"
        description="Pipeline reports, output datasets, and downloadable artifacts will be listed here after Workbench runs complete."
        icon={FileText}
        columns={["Result", "Pipeline", "Type", "Created"]}
      />
    </PageContainer>
  );
}
