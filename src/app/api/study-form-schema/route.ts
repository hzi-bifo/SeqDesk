import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";

// Default study form groups
const DEFAULT_STUDY_GROUPS: FormFieldGroup[] = [
  { id: "group_study_info", name: "Study Information", order: 0 },
  { id: "group_metadata", name: "Metadata", order: 1 },
];

// GET study form schema (public to authenticated users)
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true },
    });

    // Parse configuration
    let fields: FormFieldDefinition[] = [];
    let groups: FormFieldGroup[] = DEFAULT_STUDY_GROUPS;

    if (settings?.extraSettings) {
      try {
        const extra = JSON.parse(settings.extraSettings);
        fields = extra.studyFormFields || [];
        groups = extra.studyFormGroups || DEFAULT_STUDY_GROUPS;
      } catch {
        // Use defaults on parse error
      }
    }

    // Determine which modules are enabled
    const hasMixsModule = fields.some((f) => f.type === "mixs");
    const hasSampleAssociation = fields.some((f) => f.name === "_sample_association");
    const hasFundingModule = fields.some((f) => f.type === "funding");

    // Separate study-level fields from per-sample fields
    const studyFields = fields.filter((f) => !f.perSample && f.name !== "_sample_association");
    const perSampleFields = fields.filter((f) => f.perSample);

    // Return configuration
    return NextResponse.json({
      fields,
      studyFields,
      perSampleFields,
      groups,
      modules: {
        mixs: hasMixsModule,
        sampleAssociation: hasSampleAssociation,
        funding: hasFundingModule,
      },
    });
  } catch (error) {
    console.error("Error fetching study form schema:", error);
    return NextResponse.json(
      { error: "Failed to fetch study form schema" },
      { status: 500 }
    );
  }
}
