import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseTechConfig } from "@/lib/sequencing-tech/config";

// Storage key in SiteSettings.extraSettings
const SETTINGS_KEY = "sequencingTechConfig";

// GET available sequencing technologies (public endpoint for order form)
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

    const config = parseTechConfig(extraSettings[SETTINGS_KEY] ?? null);

    // Filter to only available technologies and sort by order
    const availableTechnologies = config.technologies
      .filter((t) => t.available && !t.comingSoon)
      .sort((a, b) => a.order - b.order);

    const availableDevices = (config.devices || [])
      .filter((d) => d.available && !d.comingSoon)
      .sort((a, b) => a.order - b.order);
    const availableFlowCells = (config.flowCells || [])
      .filter((fc) => fc.available)
      .sort((a, b) => a.order - b.order);
    const availableKits = (config.kits || [])
      .filter((kit) => kit.available)
      .sort((a, b) => a.order - b.order);
    const availableSoftware = (config.software || [])
      .filter((tool) => tool.available)
      .sort((a, b) => a.order - b.order);

    return NextResponse.json({
      technologies: availableTechnologies,
      devices: availableDevices,
      flowCells: availableFlowCells,
      kits: availableKits,
      software: availableSoftware,
    });
  } catch (error) {
    console.error("Error fetching sequencing technologies:", error);
    return NextResponse.json(
      { error: "Failed to fetch technologies" },
      { status: 500 }
    );
  }
}
