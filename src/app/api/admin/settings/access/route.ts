import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

function parseExtraSettings(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// GET - retrieve access settings
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

  try {
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true, postSubmissionInstructions: true },
    });

    const extra = parseExtraSettings(settings?.extraSettings);

    if (!isFacilityAdmin) {
      return NextResponse.json({
        allowUserAssemblyDownload: extra.allowUserAssemblyDownload ?? false,
      });
    }

    return NextResponse.json({
      departmentSharing: extra.departmentSharing ?? false,
      allowDeleteSubmittedOrders: extra.allowDeleteSubmittedOrders ?? false,
      allowUserAssemblyDownload: extra.allowUserAssemblyDownload ?? false,
      orderNotesEnabled: extra.orderNotesEnabled ?? true,
      postSubmissionInstructions: settings?.postSubmissionInstructions ?? null,
    });
  } catch {
    if (!isFacilityAdmin) {
      return NextResponse.json({
        allowUserAssemblyDownload: false,
      });
    }

    return NextResponse.json({
      departmentSharing: false,
      allowDeleteSubmittedOrders: false,
      allowUserAssemblyDownload: false,
      orderNotesEnabled: true,
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
    const {
      departmentSharing,
      allowDeleteSubmittedOrders,
      allowUserAssemblyDownload,
      orderNotesEnabled,
      postSubmissionInstructions,
    } = body;

    // Get current settings
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
    });

    const extraSettings = parseExtraSettings(settings?.extraSettings);

    // Update the extraSettings (only if provided)
    if (departmentSharing !== undefined) {
      extraSettings.departmentSharing = departmentSharing;
    }
    if (allowDeleteSubmittedOrders !== undefined) {
      extraSettings.allowDeleteSubmittedOrders = allowDeleteSubmittedOrders;
    }
    if (allowUserAssemblyDownload !== undefined) {
      extraSettings.allowUserAssemblyDownload = allowUserAssemblyDownload;
    }
    if (orderNotesEnabled !== undefined) {
      extraSettings.orderNotesEnabled = orderNotesEnabled;
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
