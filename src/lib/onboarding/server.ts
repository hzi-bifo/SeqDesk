import { db } from "@/lib/db";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { loadConfig } from "@/lib/config/loader";
import { lockSiteSettingsExtraSettings } from "@/lib/seed/extra-settings-flag";
import { getOnboardingItems, ONBOARDING_SCHEMA_VERSION } from "./definitions";
import { buildOnboardingStatus, parseStoredOnboardingState } from "./status";
import type { OnboardingStatus, StoredOnboardingState } from "./types";

const ONBOARDING_EXTRA_SETTINGS_KEY = "profileOnboarding";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseExtraSettings(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return {};
  }
}

function requiredOnboardingVersion(): number {
  const value = loadConfig().config.deployment?.onboardingVersion;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const profile = getServerDeploymentProfile();
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { extraSettings: true },
  });
  const extra = parseExtraSettings(settings?.extraSettings);
  const stored = parseStoredOnboardingState(
    extra[ONBOARDING_EXTRA_SETTINGS_KEY],
    profile.id
  );
  return buildOnboardingStatus({
    profile: profile.id,
    requiredVersion: requiredOnboardingVersion(),
    stored,
  });
}

export async function setOnboardingItemCompletion(args: {
  itemId: string;
  complete: boolean;
  actorUserId: string;
}): Promise<OnboardingStatus> {
  const profile = getServerDeploymentProfile();
  const definitions = getOnboardingItems(profile.id);
  if (!definitions.some((item) => item.id === args.itemId)) {
    throw new Error("Unknown onboarding item.");
  }
  const requiredVersion = requiredOnboardingVersion();
  const now = new Date().toISOString();

  const stored = await db.$transaction(async (tx) => {
    await lockSiteSettingsExtraSettings(tx);
    const settings = await tx.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true },
    });
    if (!settings) {
      throw new Error("Site settings are unavailable.");
    }
    const extra = parseExtraSettings(settings.extraSettings);
    const current = parseStoredOnboardingState(
      extra[ONBOARDING_EXTRA_SETTINGS_KEY],
      profile.id
    );
    const items = { ...(current?.items ?? {}) };
    if (args.complete) {
      items[args.itemId] = {
        completedAt: now,
        completedByUserId: args.actorUserId,
      };
    } else {
      delete items[args.itemId];
    }

    const allRequiredComplete = definitions
      .filter((item) => item.requirement === "required")
      .every((item) => Boolean(items[item.id]));
    const next: StoredOnboardingState = {
      schemaVersion: ONBOARDING_SCHEMA_VERSION,
      profile: profile.id,
      items,
      ...(allRequiredComplete
        ? {
            completedAt: current?.completedAt ?? now,
            completedByUserId: current?.completedByUserId ?? args.actorUserId,
          }
        : {}),
    };
    extra[ONBOARDING_EXTRA_SETTINGS_KEY] = next;
    await tx.siteSettings.update({
      where: { id: "singleton" },
      data: { extraSettings: JSON.stringify(extra) },
    });
    return next;
  });

  return buildOnboardingStatus({ profile: profile.id, requiredVersion, stored });
}
