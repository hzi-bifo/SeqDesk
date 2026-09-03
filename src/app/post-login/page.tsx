import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth";
import { isActiveSession } from "@/lib/auth-session";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { getOnboardingStatus } from "@/lib/onboarding/server";
import { decideCapability } from "@/lib/authorization";

export default async function PostLoginPage() {
  const session = await getServerSession(authOptions);
  if (!isActiveSession(session)) redirect("/login");
  const deploymentProfile = getServerDeploymentProfile();

  let needsAdministratorOnboarding = false;
  if (!session.user.isDemo) {
    try {
      const onboarding = await getOnboardingStatus();
      needsAdministratorOnboarding = Boolean(
        onboarding.required &&
        !onboarding.complete &&
        decideCapability(
          session,
          "system.settings.manage",
          deploymentProfile
        ).allowed
      );
    } catch (error) {
      console.error("[Post login] Could not evaluate onboarding status:", error);
    }
  }
  if (needsAdministratorOnboarding) redirect("/admin/onboarding");

  redirect(deploymentProfile.defaultRoute);
}
