import { db } from "@/lib/db";
import { SEED_DUMMY_ENABLED_KEY } from "./dummy-orders";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseExtraSettings(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return {};
  }
}

/**
 * Reads the persisted "dummy data enabled" flag from SiteSettings.extraSettings.
 * Returns null when there is no SiteSettings row yet (fresh install) or the flag
 * is not set. Distinguishing null from false lets the UI show "unknown" before the
 * admin has ever toggled it.
 */
export async function getDummyDataEnabledFlag(): Promise<boolean | null> {
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { extraSettings: true },
  });
  if (!settings) return null;
  const extra = parseExtraSettings(settings.extraSettings);
  const value = extra[SEED_DUMMY_ENABLED_KEY];
  return typeof value === "boolean" ? value : null;
}

/**
 * Persists the flag into SiteSettings.extraSettings. Merges with whatever else is
 * stored there. Silently no-ops if SiteSettings doesn't exist (caller can decide
 * whether that's an error).
 */
export async function setDummyDataEnabledFlag(enabled: boolean): Promise<void> {
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { extraSettings: true },
  });
  if (!settings) return;
  const extra = parseExtraSettings(settings.extraSettings);
  extra[SEED_DUMMY_ENABLED_KEY] = enabled;
  await db.siteSettings.update({
    where: { id: "singleton" },
    data: { extraSettings: JSON.stringify(extra) },
  });
}
