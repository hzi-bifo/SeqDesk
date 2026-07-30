import { getServerSession } from "next-auth";
import { Download } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { WorkbenchPageHeader } from "@/components/workbench/WorkbenchPageShell";
import { WorkbenchImportsClient } from "@/components/workbench/WorkbenchImportsClient";
import { authOptions } from "@/lib/auth";

export default async function WorkbenchImportsPage() {
  const session = await getServerSession(authOptions);

  return (
    <PageContainer>
      <WorkbenchPageHeader
        title="Imports"
        description="URL, archive, and file import jobs for the private Workbench workspace."
        icon={Download}
      />

      <WorkbenchImportsClient enablePolling={session?.user?.isDemo !== true} />
    </PageContainer>
  );
}
