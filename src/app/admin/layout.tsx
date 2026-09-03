import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AdminDemoReadOnlyWrapper } from "@/components/demo/AdminDemoReadOnlyWrapper";
import { getCurrentVersion } from "@/lib/updater";
import { isPublicDemoEnabled } from "@/lib/demo/config";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { decideCapability } from "@/lib/authorization";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect(isPublicDemoEnabled() ? "/demo" : "/login");
  }

  const deploymentProfile = getServerDeploymentProfile();

  if (
    !decideCapability(
      session,
      "system.settings.manage",
      deploymentProfile
    ).allowed
  ) {
    redirect(deploymentProfile.defaultRoute);
  }

  // Demo facility admins can view admin pages (read-only) but not modify anything

  const version = getCurrentVersion();

  return (
    <div className="min-h-screen bg-background">
      <DashboardShell
        user={session.user}
        version={version}
        deploymentProfile={deploymentProfile}
      >
        <AdminDemoReadOnlyWrapper isDemo={!!session.user.isDemo}>
          {children}
        </AdminDemoReadOnlyWrapper>
      </DashboardShell>
    </div>
  );
}
