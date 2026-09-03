import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { decideCapability } from "@/lib/authorization";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { loadStudyFormSchema } from "@/lib/studies/schema";

// GET study form schema (public to authenticated users)
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    const deploymentProfile = getServerDeploymentProfile();
    const readAccess = decideCapability(
      session,
      "studies.read",
      deploymentProfile
    );
    if (!readAccess.allowed) {
      return NextResponse.json(
        {
          error:
            readAccess.status === 401
              ? "Unauthorized"
              : readAccess.status === 404
                ? "Not found"
                : "Forbidden",
        },
        { status: readAccess.status }
      );
    }

    // When the dynamic-studies module is enabled, a `?studyId=` scopes the
    // schema to that study's own questionnaire; otherwise the global form.
    const studyId =
      new URL(request.url).searchParams.get("studyId") ?? undefined;

    const schema = await loadStudyFormSchema({
      isFacilityAdmin: decideCapability(
        session,
        "orders.process",
        deploymentProfile
      ).allowed,
      applyRoleFilter: true,
      applyModuleFilter: true,
      studyId,
    });

    // Return configuration
    return NextResponse.json({
      fields: schema.fields,
      studyFields: schema.studyFields,
      perSampleFields: schema.perSampleFields,
      groups: schema.groups,
      modules: schema.modules,
    });
  } catch (error) {
    console.error("Error fetching study form schema:", error);
    return NextResponse.json(
      { error: "Failed to fetch study form schema" },
      { status: 500 }
    );
  }
}
