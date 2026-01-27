import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  BillingSettings,
  DEFAULT_BILLING_SETTINGS,
} from "@/lib/modules/types";

// Storage key in SiteSettings
const SETTINGS_KEY = "billingSettings";

function parseSettings(settingsJson: string | null): BillingSettings {
  if (!settingsJson) {
    return DEFAULT_BILLING_SETTINGS;
  }
  try {
    return { ...DEFAULT_BILLING_SETTINGS, ...JSON.parse(settingsJson) };
  } catch {
    return DEFAULT_BILLING_SETTINGS;
  }
}

// GET billing settings
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
    });

    // Get settings from the extra field
    const rawSettings = settings?.extraSettings as string | null | undefined;
    let extraSettings: Record<string, string> = {};

    if (rawSettings) {
      try {
        extraSettings = JSON.parse(rawSettings);
      } catch {
        // ignore
      }
    }

    const billingSettings = parseSettings(extraSettings[SETTINGS_KEY] ?? null);

    return NextResponse.json({ settings: billingSettings });
  } catch (error) {
    console.error("Error fetching billing settings:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

// PUT update billing settings (admin only)
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { settings } = body as { settings: BillingSettings };

    if (!settings) {
      return NextResponse.json(
        { error: "Settings are required" },
        { status: 400 }
      );
    }

    // Validate settings
    if (settings.pspEnabled) {
      // Ensure valid ranges
      if (settings.pspPrefixRange.min < 0 || settings.pspPrefixRange.max > 9) {
        return NextResponse.json(
          { error: "PSP prefix range must be between 0 and 9" },
          { status: 400 }
        );
      }
      if (settings.pspMainDigits < 1 || settings.pspMainDigits > 20) {
        return NextResponse.json(
          { error: "PSP main digits must be between 1 and 20" },
          { status: 400 }
        );
      }
      if (settings.pspSuffixRange.min < 0 || settings.pspSuffixRange.max > 99) {
        return NextResponse.json(
          { error: "PSP suffix range must be between 0 and 99" },
          { status: 400 }
        );
      }
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

    // Update billing settings
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
    console.error("Error updating billing settings:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
