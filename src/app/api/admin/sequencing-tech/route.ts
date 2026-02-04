import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  SequencingTechConfig,
} from "@/types/sequencing-technology";
import {
  loadDefaultTechConfig,
  parseTechConfig,
} from "@/lib/sequencing-tech/config";

// Storage key in SiteSettings.extraSettings
const SETTINGS_KEY = "sequencingTechConfig";

// External API URL for syncing technologies
const SEQDESK_API_URL =
  process.env.SEQDESK_API_URL ||
  "https://seqdesk.com/api/registry/sequencing-tech";

type MergeableItem = { id: string; available?: boolean; localOverrides?: boolean };

const mergeItems = <T extends MergeableItem>(localItems: T[], remoteItems: T[]) => {
  const localById = new Map(localItems.map((item) => [item.id, item]));
  const remoteById = new Map(remoteItems.map((item) => [item.id, item]));
  const merged: T[] = [];

  for (const remoteItem of remoteItems) {
    const localItem = localById.get(remoteItem.id);
    if (!localItem) {
      merged.push(remoteItem);
      continue;
    }
    if (localItem.localOverrides) {
      merged.push(localItem);
      continue;
    }
    merged.push({
      ...remoteItem,
      available: localItem.available ?? remoteItem.available,
      localOverrides: localItem.localOverrides ?? remoteItem.localOverrides,
    });
  }

  for (const localItem of localItems) {
    if (!remoteById.has(localItem.id)) {
      merged.push(localItem);
    }
  }

  return merged;
};

// GET sequencing technologies config
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

    return NextResponse.json({ config });
  } catch (error) {
    console.error("Error fetching sequencing tech config:", error);
    return NextResponse.json(
      { error: "Failed to fetch config" },
      { status: 500 }
    );
  }
}

// PUT update sequencing technologies config (admin only)
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { config } = body as { config: SequencingTechConfig };

    if (!config) {
      return NextResponse.json(
        { error: "Config is required" },
        { status: 400 }
      );
    }

    // Validate config
    if (!Array.isArray(config.technologies)) {
      return NextResponse.json(
        { error: "Technologies must be an array" },
        { status: 400 }
      );
    }

    // Get current extra settings
    const currentSettings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
    });

    let extraSettings: Record<string, string> = {};
    const rawSettings = currentSettings?.extraSettings as
      | string
      | null
      | undefined;
    if (rawSettings) {
      try {
        extraSettings = JSON.parse(rawSettings);
      } catch {
        // ignore
      }
    }

    // Update sequencing tech config
    const updatedConfig: SequencingTechConfig = {
      ...config,
      devices: config.devices ?? [],
      flowCells: config.flowCells ?? [],
      kits: config.kits ?? [],
      software: config.software ?? [],
      version: (config.version || 0) + 1,
    };
    extraSettings[SETTINGS_KEY] = JSON.stringify(updatedConfig);

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

    return NextResponse.json({ config: updatedConfig });
  } catch (error) {
    console.error("Error updating sequencing tech config:", error);
    return NextResponse.json(
      { error: "Failed to update config" },
      { status: 500 }
    );
  }
}

// POST reset to defaults
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { action } = body as { action: string };

    if (action === "reset") {
      // Reset to defaults from file
      const defaults = loadDefaultTechConfig();

      // Get current extra settings
      const currentSettings = await db.siteSettings.findUnique({
        where: { id: "singleton" },
      });

      let extraSettings: Record<string, string> = {};
      const rawSettings = currentSettings?.extraSettings as
        | string
        | null
        | undefined;
      if (rawSettings) {
        try {
          extraSettings = JSON.parse(rawSettings);
        } catch {
          // ignore
        }
      }

      // Reset config to defaults
      extraSettings[SETTINGS_KEY] = JSON.stringify(defaults);

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

      return NextResponse.json({
        config: defaults,
        message: "Reset to defaults",
      });
    }

    if (action === "check-updates") {
      try {
        // Fetch latest technologies from SeqDesk API
        const response = await fetch(SEQDESK_API_URL, {
          headers: {
            "Accept": "application/json",
          },
          next: { revalidate: 0 }, // Don't cache this request
        });

        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }

        const remoteData = await response.json();
        const remoteConfig: SequencingTechConfig =
          remoteData?.config && typeof remoteData.config === "object"
            ? remoteData.config
            : remoteData;

        // Get current config
        const currentSettings = await db.siteSettings.findUnique({
          where: { id: "singleton" },
        });

        let extraSettings: Record<string, string> = {};
        const rawSettings = currentSettings?.extraSettings as
          | string
          | null
          | undefined;
        if (rawSettings) {
          try {
            extraSettings = JSON.parse(rawSettings);
          } catch {
            // ignore
          }
        }

        const currentConfig = parseTechConfig(extraSettings[SETTINGS_KEY] ?? null);
        const currentVersion = currentConfig.version || 0;
        const remoteVersion = parseInt(String(remoteConfig.version || 0)) || 0;

        // Compare versions
        if (remoteVersion > currentVersion) {
          const remoteTechnologies = Array.isArray(remoteConfig.technologies)
            ? remoteConfig.technologies
            : [];
          const remoteDevices = Array.isArray(remoteConfig.devices)
            ? remoteConfig.devices
            : [];
          const remoteFlowCells = Array.isArray(remoteConfig.flowCells)
            ? remoteConfig.flowCells
            : [];
          const remoteKits = Array.isArray(remoteConfig.kits)
            ? remoteConfig.kits
            : [];
          const remoteSoftware = Array.isArray(remoteConfig.software)
            ? remoteConfig.software
            : [];

          const mergedConfig: SequencingTechConfig = {
            ...currentConfig,
            technologies: mergeItems(currentConfig.technologies, remoteTechnologies),
            devices: mergeItems(currentConfig.devices || [], remoteDevices),
            flowCells: mergeItems(currentConfig.flowCells || [], remoteFlowCells),
            kits: mergeItems(currentConfig.kits || [], remoteKits),
            software: mergeItems(currentConfig.software || [], remoteSoftware),
            version: remoteVersion,
            lastSyncedAt: new Date().toISOString(),
            syncUrl: SEQDESK_API_URL,
          };

          // Save merged config
          extraSettings[SETTINGS_KEY] = JSON.stringify(mergedConfig);

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

          return NextResponse.json({
            hasUpdates: true,
            newTechnologies: Math.max(
              0,
              (remoteConfig.technologies?.length || 0) -
                (currentConfig.technologies?.length || 0)
            ),
            updatedVersion: remoteVersion,
            message: `Updated to version ${remoteVersion}.`,
            config: mergedConfig,
          });
        }

        return NextResponse.json({
          hasUpdates: false,
          currentVersion,
          remoteVersion,
          message: "Your technologies are up to date.",
        });
      } catch (error) {
        console.error("Error checking for updates:", error);
        return NextResponse.json({
          hasUpdates: false,
          error: true,
          message: `Failed to check for updates. Make sure ${SEQDESK_API_URL} is accessible.`,
        });
      }
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Error in sequencing tech action:", error);
    return NextResponse.json({ error: "Failed to process" }, { status: 500 });
  }
}
