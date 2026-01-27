import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";

// GET - retrieve study form configuration
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true },
    });

    if (!settings?.extraSettings) {
      return NextResponse.json({ fields: [], groups: [] });
    }

    const extra = JSON.parse(settings.extraSettings);
    return NextResponse.json({
      fields: extra.studyFormFields || [],
      groups: extra.studyFormGroups || [],
    });
  } catch {
    return NextResponse.json({ fields: [], groups: [] });
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
    let settings = await db.siteSettings.findUnique({
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

    // Update study form config
    extraSettings.studyFormFields = fields || [];
    extraSettings.studyFormGroups = groups || [];

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
