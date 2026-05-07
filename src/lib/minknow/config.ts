import { db } from "@/lib/db";

export interface MinknowStreamConfig {
  enabled: boolean;
  host: string;
  grpcPort: number;
  tlsCaCertPath: string;
  outputRoot: string;
  pollIntervalMs: number;
}

export const DEFAULT_MINKNOW_CONFIG: MinknowStreamConfig = {
  enabled: false,
  host: "localhost",
  grpcPort: 9501,
  tlsCaCertPath: "",
  outputRoot: "",
  pollIntervalMs: 5000,
};

export function parseMinknowConfig(extraSettings: string | null | undefined): MinknowStreamConfig {
  if (!extraSettings) return { ...DEFAULT_MINKNOW_CONFIG };
  try {
    const parsed = JSON.parse(extraSettings) as { minknowStream?: Partial<MinknowStreamConfig> };
    return {
      ...DEFAULT_MINKNOW_CONFIG,
      ...(parsed.minknowStream ?? {}),
    };
  } catch {
    return { ...DEFAULT_MINKNOW_CONFIG };
  }
}

export async function loadMinknowConfig(): Promise<MinknowStreamConfig> {
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { extraSettings: true },
  });
  return parseMinknowConfig(settings?.extraSettings);
}

export async function saveMinknowConfig(next: MinknowStreamConfig): Promise<void> {
  const current = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { extraSettings: true },
  });

  let extra: Record<string, unknown> = {};
  if (current?.extraSettings) {
    try {
      extra = JSON.parse(current.extraSettings) as Record<string, unknown>;
    } catch {
      extra = {};
    }
  }
  extra.minknowStream = next;

  await db.siteSettings.upsert({
    where: { id: "singleton" },
    update: { extraSettings: JSON.stringify(extra) },
    create: { id: "singleton", extraSettings: JSON.stringify(extra) },
  });
}
