import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET - retrieve access settings
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true, postSubmissionInstructions: true },
    });

    let extra: Record<string, unknown> = {};
    if (settings?.extraSettings) {
      try {
        extra = JSON.parse(settings.extraSettings);
      } catch {
        extra = {};
      }
    }

    return NextResponse.json({
      departmentSharing: extra.departmentSharing ?? false,
      allowDeleteSubmittedOrders: extra.allowDeleteSubmittedOrders ?? false,
      postSubmissionInstructions: settings?.postSubmissionInstructions ?? null,
    });
  } catch {
    return NextResponse.json({
      departmentSharing: false,
      allowDeleteSubmittedOrders: false,
      postSubmissionInstructions: null,
    });
  }
}

// PUT - update access settings
export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { departmentSharing, allowDeleteSubmittedOrders, postSubmissionInstructions } = body;

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

    // Update the extraSettings (only if provided)
    if (departmentSharing !== undefined) {
      extraSettings.departmentSharing = departmentSharing;
    }
    if (allowDeleteSubmittedOrders !== undefined) {
      extraSettings.allowDeleteSubmittedOrders = allowDeleteSubmittedOrders;
    }

    // Build update object
    const updateData: { extraSettings: string; postSubmissionInstructions?: string } = {
      extraSettings: JSON.stringify(extraSettings),
    };
    if (postSubmissionInstructions !== undefined) {
      updateData.postSubmissionInstructions = postSubmissionInstructions;
    }

    // Upsert the settings
    await db.siteSettings.upsert({
      where: { id: "singleton" },
      update: updateData,
      create: {
        id: "singleton",
        ...updateData,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Access Settings] Error saving:", error);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
