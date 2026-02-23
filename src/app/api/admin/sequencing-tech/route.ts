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
const USE_LOCAL_DEFAULTS = process.env.SEQDESK_USE_LOCAL_TECH_DEFAULTS === "true";

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
      merged.push({
        ...remoteItem,
        ...localItem,
        available: localItem.available ?? remoteItem.available,
        localOverrides: localItem.localOverrides ?? remoteItem.localOverrides,
      });
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

const hasMissingRemoteItems = <T extends { id: string }>(
  localItems: T[],
  remoteItems: T[]
): boolean => {
  if (!remoteItems.length) {
    return false;
  }
  const localIds = new Set(localItems.map((item) => item.id));
  return remoteItems.some((item) => !localIds.has(item.id));
};

const hasMissingRemoteBarcodeData = (
  currentConfig: SequencingTechConfig,
  remoteConfig: SequencingTechConfig
): boolean => {
  const currentBarcodeSchemes = currentConfig.barcodeSchemes || [];
  const currentBarcodeSets = currentConfig.barcodeSets || [];
  const remoteBarcodeSchemes = remoteConfig.barcodeSchemes || [];
  const remoteBarcodeSets = remoteConfig.barcodeSets || [];
  const currentKits = currentConfig.kits || [];
  const remoteKits = remoteConfig.kits || [];

  if (
    hasMissingRemoteItems(currentBarcodeSchemes, remoteBarcodeSchemes) ||
    hasMissingRemoteItems(currentBarcodeSets, remoteBarcodeSets)
  ) {
    return true;
  }

  const currentKitsById = new Map(currentKits.map((kit) => [kit.id, kit]));
  for (const remoteKit of remoteKits) {
    const currentKit = currentKitsById.get(remoteKit.id);
    if (!currentKit) {
      continue;
    }

    if (remoteKit.kitKind && !currentKit.kitKind) {
      return true;
    }
    if (remoteKit.doradoKitName && !currentKit.doradoKitName) {
      return true;
    }
    if (remoteKit.barcoding && !currentKit.barcoding) {
      return true;
    }

    if (remoteKit.barcoding && currentKit.barcoding) {
      if (remoteKit.barcoding.barcodeSetId && !currentKit.barcoding.barcodeSetId) {
        return true;
      }
      if (
        typeof remoteKit.barcoding.maxBarcodesPerRun === "number" &&
        typeof currentKit.barcoding.maxBarcodesPerRun !== "number"
      ) {
        return true;
      }
      if (
        Array.isArray(remoteKit.barcoding.compatibleBarcodeKits) &&
        remoteKit.barcoding.compatibleBarcodeKits.length > 0 &&
        (!Array.isArray(currentKit.barcoding.compatibleBarcodeKits) ||
          currentKit.barcoding.compatibleBarcodeKits.length === 0)
      ) {
        return true;
      }
    }
  }

  return false;
};

const normalizeRemoteConfig = (raw: SequencingTechConfig): SequencingTechConfig => {
  const defaults = loadDefaultTechConfig();
  return {
    ...defaults,
    ...raw,
    technologies: Array.isArray(raw.technologies) ? raw.technologies : [],
    devices: Array.isArray(raw.devices) ? raw.devices : [],
    flowCells: Array.isArray(raw.flowCells) ? raw.flowCells : [],
    kits: Array.isArray(raw.kits) ? raw.kits : [],
    software: Array.isArray(raw.software) ? raw.software : [],
    barcodeSchemes: Array.isArray(raw.barcodeSchemes) ? raw.barcodeSchemes : [],
    barcodeSets: Array.isArray(raw.barcodeSets) ? raw.barcodeSets : [],
    version: parseInt(String(raw.version || 0)) || 0,
  };
};

const fetchRemoteConfig = async (): Promise<SequencingTechConfig> => {
  const response = await fetch(SEQDESK_API_URL, {
    headers: {
      Accept: "application/json",
    },
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    throw new Error(`API returned ${response.status}`);
  }

  const remoteData = await response.json();
  const remoteConfig: SequencingTechConfig =
    remoteData?.config && typeof remoteData.config === "object"
      ? remoteData.config
      : remoteData;

  const normalized = normalizeRemoteConfig(remoteConfig);
  return {
    ...normalized,
    lastSyncedAt: new Date().toISOString(),
    syncUrl: SEQDESK_API_URL,
  };
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

    const storedConfig = extraSettings[SETTINGS_KEY] ?? null;

    if (!storedConfig) {
      try {
        const remoteConfig = await fetchRemoteConfig();
        extraSettings[SETTINGS_KEY] = JSON.stringify(remoteConfig);

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

        return NextResponse.json({ config: remoteConfig });
      } catch (error) {
        console.error("Error auto-syncing sequencing tech config:", error);
      }
    }

    const config = parseTechConfig(storedConfig);
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
      barcodeSchemes: config.barcodeSchemes ?? [],
      barcodeSets: config.barcodeSets ?? [],
      version: config.version ?? 1,
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
      // Reset to defaults (local file or remote registry)
      const defaults = USE_LOCAL_DEFAULTS
        ? loadDefaultTechConfig()
        : await fetchRemoteConfig();

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
        message: USE_LOCAL_DEFAULTS
          ? "Reset to defaults"
          : "Reset to registry defaults",
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
        const normalizedRemoteConfig = normalizeRemoteConfig(remoteConfig);

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
        const remoteVersion = parseInt(String(normalizedRemoteConfig.version || 0)) || 0;

        const hasMissingRemoteCoreItems =
          hasMissingRemoteItems(
            currentConfig.technologies || [],
            normalizedRemoteConfig.technologies || []
          ) ||
          hasMissingRemoteItems(currentConfig.devices || [], normalizedRemoteConfig.devices || []) ||
          hasMissingRemoteItems(currentConfig.flowCells || [], normalizedRemoteConfig.flowCells || []) ||
          hasMissingRemoteItems(currentConfig.kits || [], normalizedRemoteConfig.kits || []) ||
          hasMissingRemoteItems(currentConfig.software || [], normalizedRemoteConfig.software || []);

        const shouldUpdate =
          remoteVersion > currentVersion ||
          (currentConfig.technologies.length === 0 &&
            normalizedRemoteConfig.technologies.length > 0) ||
          hasMissingRemoteCoreItems ||
          hasMissingRemoteBarcodeData(currentConfig, normalizedRemoteConfig);

        // Compare versions
        if (shouldUpdate) {
          const remoteTechnologies = normalizedRemoteConfig.technologies || [];
          const remoteDevices = normalizedRemoteConfig.devices || [];
          const remoteFlowCells = normalizedRemoteConfig.flowCells || [];
          const remoteKits = normalizedRemoteConfig.kits || [];
          const remoteSoftware = normalizedRemoteConfig.software || [];
          const remoteBarcodeSchemes = normalizedRemoteConfig.barcodeSchemes || [];
          const remoteBarcodeSets = normalizedRemoteConfig.barcodeSets || [];

          const mergedConfig: SequencingTechConfig = {
            ...currentConfig,
            technologies: mergeItems(currentConfig.technologies, remoteTechnologies),
            devices: mergeItems(currentConfig.devices || [], remoteDevices),
            flowCells: mergeItems(currentConfig.flowCells || [], remoteFlowCells),
            kits: mergeItems(currentConfig.kits || [], remoteKits),
            software: mergeItems(currentConfig.software || [], remoteSoftware),
            barcodeSchemes: mergeItems(currentConfig.barcodeSchemes || [], remoteBarcodeSchemes),
            barcodeSets: mergeItems(currentConfig.barcodeSets || [], remoteBarcodeSets),
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
              (normalizedRemoteConfig.technologies?.length || 0) -
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
