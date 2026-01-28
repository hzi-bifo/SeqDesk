import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  SequencingTechnology,
  SequencingTechConfig,
  DEFAULT_TECH_CONFIG,
} from "@/types/sequencing-technology";
import fs from "fs";
import path from "path";

// Storage key in SiteSettings.extraSettings
const SETTINGS_KEY = "sequencingTechConfig";

function loadDefaultsFromFile(): SequencingTechConfig {
  try {
    const filePath = path.join(
      process.cwd(),
      "data/sequencing-technologies/defaults.json"
    );
    const fileContent = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(fileContent) as SequencingTechConfig;
  } catch (error) {
    console.error("Error loading defaults file:", error);
    return DEFAULT_TECH_CONFIG;
  }
}

function parseConfig(configJson: string | null): SequencingTechConfig {
  if (!configJson) {
    return loadDefaultsFromFile();
  }
  try {
    return JSON.parse(configJson) as SequencingTechConfig;
  } catch {
    return loadDefaultsFromFile();
  }
}

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

    const config = parseConfig(extraSettings[SETTINGS_KEY] ?? null);

    // Filter to only available technologies and sort by order
    const availableTechnologies = config.technologies
      .filter((t) => t.available && !t.comingSoon)
      .sort((a, b) => a.order - b.order);

    return NextResponse.json({ technologies: availableTechnologies });
  } catch (error) {
    console.error("Error fetching sequencing technologies:", error);
    return NextResponse.json(
      { error: "Failed to fetch technologies" },
      { status: 500 }
    );
  }
}
