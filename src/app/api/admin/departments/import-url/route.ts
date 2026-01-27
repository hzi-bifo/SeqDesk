import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET - retrieve saved import URL
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
      return NextResponse.json({ url: null, lastImportedAt: null });
    }

    const extra = JSON.parse(settings.extraSettings);
    return NextResponse.json({
      url: extra.departmentImportUrl || null,
      lastImportedAt: extra.departmentImportLastUsed || null,
    });
  } catch {
    return NextResponse.json({ url: null, lastImportedAt: null });
  }
}

// POST - save import URL
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { url } = await request.json();

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

    // Update the department import URL
    extraSettings.departmentImportUrl = url;
    extraSettings.departmentImportLastUsed = new Date().toISOString();

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
    console.error("[Import URL] Error saving:", error);
    return NextResponse.json({ error: "Failed to save URL" }, { status: 500 });
  }
}
