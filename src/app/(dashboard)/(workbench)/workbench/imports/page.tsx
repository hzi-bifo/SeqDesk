import { Download } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { WorkbenchPageHeader } from "@/components/workbench/WorkbenchPageShell";
import { WorkbenchImportsClient } from "@/components/workbench/WorkbenchImportsClient";

export default function WorkbenchImportsPage() {
  return (
    <PageContainer>
      <WorkbenchPageHeader
        title="Imports"
        description="URL, archive, and file import jobs for the private Workbench workspace."
        icon={Download}
      />

      <WorkbenchImportsClient />
    </PageContainer>
  );
}
