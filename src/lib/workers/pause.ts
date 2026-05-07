import { db } from "@/lib/db";

/**
 * Soft pause for background workers. The flag lives in `SiteSettings.extraSettings.workerPause`
 * and the daemon checks it on each tick — when set, ingest steps are skipped
 * but the watcher stays attached so we can resume without losing state.
 *
 * Keyed by worker name (e.g. "stream-monitor"); only workers with
 * `supportsPause: true` in the registry should be paused.
 */

const KEY = "workerPause";

type ExtraSettingsShape = Record<string, unknown>;

async function readExtra(): Promise<ExtraSettingsShape> {
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { extraSettings: true },
  });
  if (!settings?.extraSettings) return {};
  try {
    const parsed = JSON.parse(settings.extraSettings) as ExtraSettingsShape;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeExtra(extra: ExtraSettingsShape): Promise<void> {
  await db.siteSettings.upsert({
    where: { id: "singleton" },
    update: { extraSettings: JSON.stringify(extra) },
    create: { id: "singleton", extraSettings: JSON.stringify(extra) },
  });
}

export async function isWorkerPaused(name: string): Promise<boolean> {
  const extra = await readExtra();
  const map = (extra[KEY] ?? {}) as Record<string, unknown>;
  return Boolean(map[name]);
}

export async function setWorkerPaused(name: string, paused: boolean): Promise<void> {
  const extra = await readExtra();
  const current = (extra[KEY] && typeof extra[KEY] === "object" ? (extra[KEY] as Record<string, unknown>) : {});
  const next: Record<string, unknown> = { ...current };
  if (paused) {
    next[name] = true;
  } else {
    delete next[name];
  }
  extra[KEY] = next;
  await writeExtra(extra);
}

export async function listPausedWorkers(): Promise<string[]> {
  const extra = await readExtra();
  const map = (extra[KEY] ?? {}) as Record<string, unknown>;
  return Object.keys(map).filter((k) => Boolean(map[k]));
}
