import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getDefaultTechSyncUrl,
  parseTechConfig,
  withResolvedTechAssetUrls,
} from "@/lib/sequencing-tech/config";

// Storage key in SiteSettings.extraSettings
const SETTINGS_KEY = "sequencingTechConfig";
const DEFAULT_SEQDESK_API_URL = getDefaultTechSyncUrl();
export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET available sequencing technologies (public endpoint for order form)
export async function GET() {
  try {
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
    });

    // Get settings from the extra field
    const rawSettings = settings?.extraSettings as string | null | undefined;
    let extraSettings: Record<string, unknown> = {};

    if (rawSettings) {
      try {
        const parsed = JSON.parse(rawSettings);
        if (parsed && typeof parsed === "object") {
          extraSettings = parsed as Record<string, unknown>;
        }
      } catch {
        // ignore
      }
    }

    const parsedConfig = parseTechConfig(extraSettings[SETTINGS_KEY] ?? null);
    const config = withResolvedTechAssetUrls(
      {
        ...parsedConfig,
        syncUrl: parsedConfig.syncUrl || DEFAULT_SEQDESK_API_URL,
      },
      DEFAULT_SEQDESK_API_URL
    );

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

    return NextResponse.json(
      {
        technologies: availableTechnologies,
        devices: availableDevices,
        flowCells: availableFlowCells,
        kits: availableKits,
        software: availableSoftware,
        barcodeSchemes: config.barcodeSchemes || [],
        barcodeSets: config.barcodeSets || [],
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("Error fetching sequencing technologies:", error);
    return NextResponse.json(
      { error: "Failed to fetch technologies" },
      { status: 500 }
    );
  }
}
