import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";
import { STUDY_FORM_DEFAULTS_VERSION } from "@/lib/modules/default-form-fields";
import {
  getFixedStudySections,
  normalizeStudyFormSchema,
} from "@/lib/studies/fixed-sections";
import { loadStudyFormSchema } from "@/lib/studies/schema";

// GET - retrieve study form configuration
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const schema = await loadStudyFormSchema({
      isFacilityAdmin: true,
      applyRoleFilter: false,
      applyModuleFilter: false,
    });
    return NextResponse.json({
      fields: schema.fields,
      groups: schema.groups,
    });
  } catch {
    return NextResponse.json({ fields: [], groups: getFixedStudySections() });
  }
}

// PUT - update study form configuration
export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { fields, groups } = body as {
      fields: FormFieldDefinition[];
      groups: FormFieldGroup[];
    };

    // Get current settings
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
    });

    let extraSettings: Record<string, unknown> = {};
    if (settings?.extraSettings) {
      try {
        extraSettings = JSON.parse(settings.extraSettings);
      } catch {
        extraSettings = {};
      }
    }

    const normalized = normalizeStudyFormSchema({
      fields: fields || [],
      groups: groups || getFixedStudySections(),
    });

    // Update study form config
    extraSettings.studyFormFields = normalized.fields;
    extraSettings.studyFormGroups = normalized.groups;
    extraSettings.studyFormDefaultsVersion = STUDY_FORM_DEFAULTS_VERSION;

    // Upsert the settings
    await db.siteSettings.upsert({
      where: { id: "singleton" },
      update: { extraSettings: JSON.stringify(extraSettings) },
      create: {
        id: "singleton",
        extraSettings: JSON.stringify(extraSettings),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Study Form Config] Error updating:", error);
    return NextResponse.json({ error: "Failed to save configuration" }, { status: 500 });
  }
}
