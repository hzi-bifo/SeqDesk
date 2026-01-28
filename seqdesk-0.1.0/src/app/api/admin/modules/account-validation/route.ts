import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  AccountValidationSettings,
  DEFAULT_ACCOUNT_VALIDATION_SETTINGS,
} from "@/lib/modules/types";

// Storage key in SiteSettings
const SETTINGS_KEY = "accountValidationSettings";

function parseSettings(settingsJson: string | null): AccountValidationSettings {
  if (!settingsJson) {
    return DEFAULT_ACCOUNT_VALIDATION_SETTINGS;
  }
  try {
    return { ...DEFAULT_ACCOUNT_VALIDATION_SETTINGS, ...JSON.parse(settingsJson) };
  } catch {
    return DEFAULT_ACCOUNT_VALIDATION_SETTINGS;
  }
}

// GET account validation settings
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
    });

    // Get settings from the extra field (we'll use a JSON string field)
    const rawSettings = settings?.extraSettings as string | null | undefined;
    let extraSettings: Record<string, string> = {};

    if (rawSettings) {
      try {
        extraSettings = JSON.parse(rawSettings);
      } catch {
        // ignore
      }
    }

    const accountSettings = parseSettings(extraSettings[SETTINGS_KEY] ?? null);

    return NextResponse.json({ settings: accountSettings });
  } catch (error) {
    console.error("Error fetching account validation settings:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

// PUT update account validation settings (admin only)
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { settings } = body as { settings: AccountValidationSettings };

    if (!settings) {
      return NextResponse.json(
        { error: "Settings are required" },
        { status: 400 }
      );
    }

    // Validate allowed domains
    if (settings.allowedDomains) {
      settings.allowedDomains = settings.allowedDomains
        .map((d) => d.trim().toLowerCase())
        .filter((d) => d.length > 0 && d.includes("."));
    }

    // Get current extra settings
    const currentSettings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
    });

    let extraSettings: Record<string, string> = {};
    const rawSettings = currentSettings?.extraSettings as string | null | undefined;
    if (rawSettings) {
      try {
        extraSettings = JSON.parse(rawSettings);
      } catch {
        // ignore
      }
    }

    // Update account validation settings
    extraSettings[SETTINGS_KEY] = JSON.stringify(settings);

    // Save to database
    await db.siteSettings.upsert({
      where: { id: "singleton" },
      update: {
        extraSettings: JSON.stringify(extraSettings),
      },
      create: {
        id: "singleton",
        extraSettings: JSON.stringify(extraSettings),
      },
    });

    return NextResponse.json({ settings });
  } catch (error) {
    console.error("Error updating account validation settings:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
