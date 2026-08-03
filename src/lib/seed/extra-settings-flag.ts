import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  SEED_DUMMY_CLEANUP_PATHS_KEY,
  SEED_DUMMY_ENABLED_KEY,
} from "./dummy-orders";

type SiteSettingsClient = Pick<Prisma.TransactionClient, "siteSettings">;

export async function lockSiteSettingsExtraSettings(
  client: Pick<Prisma.TransactionClient, "$queryRaw">
): Promise<void> {
  await client.$queryRaw`
    SELECT "id"
    FROM "SiteSettings"
    WHERE "id" = 'singleton'
    FOR UPDATE
  `;
}

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

function cleanupPathsFromExtra(
  extra: Record<string, unknown>
): Record<string, string> {
  const value = extra[SEED_DUMMY_CLEANUP_PATHS_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && Boolean(entry[1].trim())
    )
  );
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
  await db.$transaction(async (tx) => {
    await lockSiteSettingsExtraSettings(tx);
    const settings = await tx.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true },
    });
    if (!settings) return;
    const extra = parseExtraSettings(settings.extraSettings);
    extra[SEED_DUMMY_ENABLED_KEY] = enabled;
    await tx.siteSettings.update({
      where: { id: "singleton" },
      data: { extraSettings: JSON.stringify(extra) },
    });
  });
}

/**
 * Returns the original storage base retained for retryable filesystem cleanup.
 * This pointer outlives the seeded Order/Study rows, which are removed before
 * the generated FASTQ directory.
 */
export async function getDummyDataCleanupPath(
  ownerUserId: string,
  client: SiteSettingsClient = db
): Promise<string | null> {
  const settings = await client.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { extraSettings: true },
  });
  if (!settings) return null;
  return cleanupPathsFromExtra(parseExtraSettings(settings.extraSettings))[
    ownerUserId
  ] ?? null;
}

/**
 * Persists or clears one owner's retryable cleanup pointer while preserving all
 * unrelated SiteSettings.extraSettings values.
 *
 * Mutation callers should hold a row lock on SiteSettings when several owners
 * can update this mapping concurrently.
 */
export async function setDummyDataCleanupPath(
  ownerUserId: string,
  dataBasePath: string | null,
  client: SiteSettingsClient = db
): Promise<void> {
  const settings = await client.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { extraSettings: true },
  });
  if (!settings) {
    throw new Error(
      "Site settings are unavailable; the demo-data cleanup location could not be persisted."
    );
  }

  const extra = parseExtraSettings(settings.extraSettings);
  const cleanupPaths = cleanupPathsFromExtra(extra);
  if (dataBasePath) {
    cleanupPaths[ownerUserId] = dataBasePath;
  } else {
    delete cleanupPaths[ownerUserId];
  }

  if (Object.keys(cleanupPaths).length > 0) {
    extra[SEED_DUMMY_CLEANUP_PATHS_KEY] = cleanupPaths;
  } else {
    delete extra[SEED_DUMMY_CLEANUP_PATHS_KEY];
  }

  await client.siteSettings.update({
    where: { id: "singleton" },
    data: { extraSettings: JSON.stringify(extra) },
  });
}
