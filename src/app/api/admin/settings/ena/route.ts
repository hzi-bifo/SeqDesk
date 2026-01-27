import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/admin/settings/ena - Get ENA settings (password masked)
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: {
        enaUsername: true,
        enaPassword: true,
        enaTestMode: true,
      },
    });

    return NextResponse.json({
      enaUsername: settings?.enaUsername || "",
      hasPassword: Boolean(settings?.enaPassword),
      enaTestMode: settings?.enaTestMode ?? true,
      configured: Boolean(settings?.enaUsername && settings?.enaPassword),
    });
  } catch (error) {
    console.error("Error fetching ENA settings:", error);
    return NextResponse.json(
      { error: "Failed to fetch ENA settings" },
      { status: 500 }
    );
  }
}

// PUT /api/admin/settings/ena - Update ENA settings
export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    // Trim whitespace from credentials
    const enaUsername = body.enaUsername?.trim();
    const enaPassword = body.enaPassword?.trim();
    const enaTestMode = body.enaTestMode;

    // Validate username format if provided
    if (enaUsername && !enaUsername.match(/^Webin-\d+$/)) {
      return NextResponse.json(
        { error: "ENA username must be in format 'Webin-XXXXX' (e.g., Webin-12345)" },
        { status: 400 }
      );
    }

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (enaUsername !== undefined) {
      updateData.enaUsername = enaUsername || null;
    }

    if (enaPassword !== undefined) {
      // Only update password if explicitly provided (not empty string means "keep existing")
      // Empty string means "clear password"
      updateData.enaPassword = enaPassword || null;
    }

    if (enaTestMode !== undefined) {
      updateData.enaTestMode = enaTestMode;
    }

    await db.siteSettings.upsert({
      where: { id: "singleton" },
      update: updateData,
      create: {
        id: "singleton",
        enaUsername: enaUsername || null,
        enaPassword: enaPassword || null,
        enaTestMode: enaTestMode ?? true,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating ENA settings:", error);
    return NextResponse.json(
      { error: "Failed to update ENA settings" },
      { status: 500 }
    );
  }
}
