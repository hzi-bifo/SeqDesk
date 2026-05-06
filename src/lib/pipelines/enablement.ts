import { db } from "@/lib/db";

export const INSTALL_PROFILE_PIPELINE_ALLOWLIST_KEY =
  "installProfilePipelineAllowlist";

type PipelineConfigState = { enabled: boolean } | null | undefined;

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function parsePipelineAllowlist(
  rawExtraSettings: unknown
): Set<string> | null {
  const extra = parseJsonObject(rawExtraSettings);
  const rawAllowlist = extra[INSTALL_PROFILE_PIPELINE_ALLOWLIST_KEY];
  if (!Array.isArray(rawAllowlist)) return null;

  return new Set(
    rawAllowlist
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

export function resolvePipelineEnabled(
  pipelineId: string,
  dbConfig: PipelineConfigState,
  allowlist: Set<string> | null
): boolean {
  if (dbConfig) return dbConfig.enabled;
  if (allowlist) return allowlist.has(pipelineId);
  return true;
}

export async function getPipelineEnabled(pipelineId: string): Promise<boolean> {
  const [dbConfig, settings] = await Promise.all([
    db.pipelineConfig.findUnique({
      where: { pipelineId },
      select: { enabled: true },
    }),
    db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true },
    }),
  ]);

  return resolvePipelineEnabled(
    pipelineId,
    dbConfig,
    parsePipelineAllowlist(settings?.extraSettings)
  );
}
