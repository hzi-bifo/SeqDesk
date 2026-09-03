import { redirect } from "next/navigation";

import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";

export default function DashboardLandingPage() {
  redirect(getServerDeploymentProfile().defaultRoute);
}
