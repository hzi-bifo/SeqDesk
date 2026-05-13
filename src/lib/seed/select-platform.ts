import { db } from "@/lib/db";
import { parseTechConfig } from "@/lib/sequencing-tech/config";
import {
  PLATFORM_BY_TECH_ID,
  PLATFORM_LONG_READ_FALLBACK,
  PLATFORM_SHORT_READ_FALLBACK,
  type PlatformProfile,
} from "./templates";

const SETTINGS_KEY = "sequencingTechConfig";

/**
 * Reads the install's configured sequencer devices from SiteSettings and returns
 * the platform profile for the first available device. Falls back to a generic
 * Illumina NovaSeq profile when nothing is configured.
 *
 * Returns the matched PlatformProfile, the device name (for instrumentModel), and
 * whether a real configured device drove the choice — so the seed factory can label
 * the order more precisely.
 */
export async function selectPlatformForSeed(): Promise<{
  primary: PlatformProfile;
  primaryDeviceName: string | null;
  fromConfiguredDevice: boolean;
}> {
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { extraSettings: true },
  });

  let extra: Record<string, unknown> = {};
  if (settings?.extraSettings) {
    try {
      const parsed = JSON.parse(settings.extraSettings);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        extra = parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through with empty extra.
    }
  }

  const config = parseTechConfig(extra[SETTINGS_KEY] ?? null);

  const enabledDevices = (config.devices ?? [])
    .filter((device) => device.available && !device.comingSoon)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const device of enabledDevices) {
    const profile = PLATFORM_BY_TECH_ID[device.platformId];
    if (profile) {
      return {
        // Use the device's display name as the instrumentModel so it matches
        // exactly what the admin set up (e.g. "MinION Mk1D" instead of "MinION").
        primary: {
          ...profile,
          instrumentModel: device.name,
          deviceId: device.id,
          deviceName: device.name,
        },
        primaryDeviceName: device.name,
        fromConfiguredDevice: true,
      };
    }
  }

  // No device configured. Fall back based on which technology families are at least available.
  const availableTechs = (config.technologies ?? []).filter(
    (tech) => tech.available && !tech.comingSoon
  );
  const hasIllumina = availableTechs.some((tech) =>
    tech.id.startsWith("illumina-")
  );
  const hasLongRead = availableTechs.some(
    (tech) => tech.id.startsWith("ont-") || tech.id.startsWith("pacbio-")
  );

  if (!hasIllumina && hasLongRead) {
    return {
      primary: PLATFORM_LONG_READ_FALLBACK,
      primaryDeviceName: null,
      fromConfiguredDevice: false,
    };
  }

  return {
    primary: PLATFORM_SHORT_READ_FALLBACK,
    primaryDeviceName: null,
    fromConfiguredDevice: false,
  };
}
