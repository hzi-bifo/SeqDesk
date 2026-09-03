import { NextResponse } from "next/server";
import { checkDatabaseStatus } from "@/lib/db-status";
import { buildSetupStatusResponse } from "@/lib/setup-status";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { getServerEnrollmentPolicy } from "@/lib/deployment-profile/enrollment.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const deploymentProfile = getServerDeploymentProfile();
  const enrollment = await getServerEnrollmentPolicy();
  const status = await checkDatabaseStatus();

  return NextResponse.json(
    {
      ...buildSetupStatusResponse(status),
      deploymentProfile: {
        id: deploymentProfile.id,
        label: deploymentProfile.label,
        description: deploymentProfile.description,
      },
      enrollment: {
        policy: enrollment.policy,
        allowSelfRegistration: enrollment.allowSelfRegistration,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
