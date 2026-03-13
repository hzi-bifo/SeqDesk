import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadStudyFormSchema } from "@/lib/studies/schema";

// GET study form schema (public to authenticated users)
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const schema = await loadStudyFormSchema({
      isFacilityAdmin: session.user.role === "FACILITY_ADMIN",
      applyRoleFilter: true,
      applyModuleFilter: true,
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
