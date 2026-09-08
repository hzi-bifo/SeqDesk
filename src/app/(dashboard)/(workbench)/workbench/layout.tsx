import { notFound } from "next/navigation";

import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";

export default function WorkbenchLayout({ children }: { children: React.ReactNode }) {
  if (!getServerDeploymentProfile().modules.includes("data-imports")) {
    notFound();
  }

  return children;
}
