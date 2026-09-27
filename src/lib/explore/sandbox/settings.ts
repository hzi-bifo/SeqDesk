import { db } from "@/lib/db";

/**
 * How analysis runs are confined.
 *
 * - `required`: every run is sandboxed; a host without bubblewrap (Linux) or
 *   sandbox-exec (macOS) refuses to start runs.
 * - `auto`: sandboxed when the host can; otherwise the run starts unconfined
 *   and says so in its log and on its page.
 * - `off`: never sandboxed. Only sensible on a single-user machine.
 */
export type SandboxMode = "required" | "auto" | "off";
export type SandboxNetworkSetting = "none" | "host";

export interface ExploreSandboxSettings {
  mode: SandboxMode;
  /** Whether analyses may reach the network. Inputs are staged, so "none" is enough for templates. */
  network: SandboxNetworkSetting;
  /** Site tool trees exposed read-only inside every sandbox (absolute paths). */
  extraReadOnly: string[];
  /** Wall-clock limit for local runs, in hours; 0 means no limit. */
  localTimeLimitHours: number;
  /** Per-run caps on CPU, memory and processes for local runs (SLURM runs use the scheduler's). */
  limits: RunResourceLimits;
}

export interface RunResourceLimits {
  /** CPU cores the run may use at once; 0 means no cap. */
  cores: number;
  /** Memory in GB for the whole run (all its processes); 0 means no cap. */
  memoryGb: number;
  /** Processes and threads the run may have at once; 0 means no cap. */
  pids: number;
}

export const DEFAULT_RUN_LIMITS: RunResourceLimits = { cores: 4, memoryGb: 16, pids: 512 };

function clampInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(0, Math.floor(value)), max);
}

export function normalizeRunLimits(raw: unknown): RunResourceLimits {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    cores: clampInt(source.cores, DEFAULT_RUN_LIMITS.cores, 1024),
    memoryGb: clampInt(source.memoryGb, DEFAULT_RUN_LIMITS.memoryGb, 16384),
    pids: clampInt(source.pids, DEFAULT_RUN_LIMITS.pids, 1_000_000),
  };
}

export const DEFAULT_SANDBOX_SETTINGS: ExploreSandboxSettings = {
  mode: "auto",
  network: "none",
  extraReadOnly: [],
  localTimeLimitHours: 12,
  limits: { ...DEFAULT_RUN_LIMITS },
};

const UNSAFE_PATH = /[\x00-\x1f\x7f"'`$\\]/;

export function normalizeSandboxSettings(raw: unknown): ExploreSandboxSettings {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const mode = source.mode === "required" || source.mode === "off" ? source.mode : "auto";
  const network = source.network === "host" ? "host" : "none";
  const extraReadOnly = Array.isArray(source.extraReadOnly)
    ? source.extraReadOnly
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.startsWith("/") && entry !== "/" && !UNSAFE_PATH.test(entry))
        .slice(0, 20)
    : [];
  const hours = typeof source.localTimeLimitHours === "number" && Number.isFinite(source.localTimeLimitHours) ? Math.max(0, Math.floor(source.localTimeLimitHours)) : DEFAULT_SANDBOX_SETTINGS.localTimeLimitHours;
  return { mode, network, extraReadOnly, localTimeLimitHours: Math.min(hours, 24 * 30), limits: normalizeRunLimits(source.limits) };
}

export async function getSandboxSettings(): Promise<ExploreSandboxSettings> {
  const stored = await db.siteSettings.findUnique({ where: { id: "singleton" }, select: { extraSettings: true } });
  if (!stored?.extraSettings) return normalizeSandboxSettings({});
  try {
    const extra = JSON.parse(stored.extraSettings) as Record<string, unknown>;
    return normalizeSandboxSettings(extra.exploreSandbox);
  } catch {
    return normalizeSandboxSettings({});
  }
}

export async function saveSandboxSettings(raw: unknown): Promise<ExploreSandboxSettings> {
  const settings = normalizeSandboxSettings(raw);
  const stored = await db.siteSettings.findUnique({ where: { id: "singleton" }, select: { extraSettings: true } });
  let extra: Record<string, unknown> = {};
  if (stored?.extraSettings) {
    try {
      extra = JSON.parse(stored.extraSettings) as Record<string, unknown>;
    } catch {
      extra = {};
    }
  }
  extra.exploreSandbox = settings;
  await db.siteSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", extraSettings: JSON.stringify(extra) },
    update: { extraSettings: JSON.stringify(extra) },
  });
  return settings;
}
