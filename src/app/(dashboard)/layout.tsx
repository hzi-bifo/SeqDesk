import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { getCurrentVersion } from "@/lib/updater";
import { isPublicDemoEnabled } from "@/lib/demo/config";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { getOnboardingStatus } from "@/lib/onboarding/server";
import { OperationalSetupPending } from "@/components/onboarding/OperationalSetupPending";
import { decideCapability } from "@/lib/authorization";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    if (!isPublicDemoEnabled()) {
      redirect("/login");
    }

    const requestHeaders = await headers();
    const fetchDest = requestHeaders.get("sec-fetch-dest");
    redirect(fetchDest === "iframe" ? "/demo/embed" : "/demo");
  }

  const version = getCurrentVersion();
  const deploymentProfile = getServerDeploymentProfile();

  let pendingOnboarding: Awaited<ReturnType<typeof getOnboardingStatus>> | null = null;
  const canManageSettings = decideCapability(
    session,
    "system.settings.manage",
    deploymentProfile
  ).allowed;
  if (!canManageSettings && !session.user.isDemo) {
    try {
      const onboarding = await getOnboardingStatus();
      if (onboarding.required && !onboarding.complete) {
        pendingOnboarding = onboarding;
      }
    } catch (error) {
      console.error("[Dashboard] Could not evaluate onboarding status:", error);
    }
  }
  if (pendingOnboarding) {
    return (
      <OperationalSetupPending
        profile={pendingOnboarding.profile}
        completedCount={pendingOnboarding.completedCount}
        totalCount={pendingOnboarding.totalCount}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardShell
        user={session.user}
        version={version}
        deploymentProfile={deploymentProfile}
      >
        {children}
      </DashboardShell>
    </div>
  );
}
