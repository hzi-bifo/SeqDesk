import { randomBytes, randomUUID } from "crypto";
import os from "os";
import { db } from "@/lib/db";
import { loadConfig } from "@/lib/config";

const SITE_SETTINGS_ID = "singleton";
const DEFAULT_ENDPOINT = "https://seqdesk.org/api/telemetry/heartbeat";
const DEFAULT_INTERVAL_HOURS = 24;
const MIN_INTERVAL_HOURS = 1;
const MAX_INTERVAL_HOURS = 168;
const FETCH_TIMEOUT_MS = 5000;

type JsonRecord = Record<string, unknown>;

export interface TelemetrySettingsView {
  enabled: boolean;
  endpoint: string;
  intervalHours: number;
  instanceId: string | null;
  clientTokenConfigured: boolean;
  installProfileId: string | null;
  installProfileVersion: string | null;
  lastSentAt: string | null;
  lastError: string | null;
  lastStatus: number | null;
  promptDismissed: boolean;
}

interface TelemetrySettingsInternal extends TelemetrySettingsView {
  clientToken: string | null;
}

export interface TelemetryHeartbeatContext {
  runningVersion: string;
  installedVersion?: string;
  updateAvailable?: boolean;
  latestVersion?: string | null;
  databaseProvider?: "postgresql" | "sqlite" | "unknown";
}

export interface TelemetryHeartbeatPayload {
  protocolVersion: 1;
  instanceId: string;
  runningVersion: string;
  installedVersion: string;
  installProfile: {
    id: string | null;
    version: string | null;
  };
  update: {
    available: boolean;
    latestVersion: string | null;
  };
  database: {
    provider: "postgresql" | "sqlite" | "unknown";
  };
  runtime: {
    platform: string;
    arch: string;
    nodeMajor: number | null;
  };
}

export interface TelemetrySendResult {
  sent: boolean;
  reason?: "disabled" | "throttled" | "missing-identity" | "invalid-endpoint" | "failed";
  status?: number;
  error?: string;
  lastSentAt?: string | null;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(raw: string | null | undefined): JsonRecord {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return undefined;
}

function normalizeIntervalHours(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_HOURS;
  const integer = Math.trunc(parsed);
  if (integer < MIN_INTERVAL_HOURS || integer > MAX_INTERVAL_HOURS) {
    return DEFAULT_INTERVAL_HOURS;
  }
  return integer;
}

function normalizeEndpoint(value: unknown): string {
  const endpoint = toOptionalString(value) || DEFAULT_ENDPOINT;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return DEFAULT_ENDPOINT;
    }
    return url.toString();
  } catch {
    return DEFAULT_ENDPOINT;
  }
}

function isValidEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function generateClientToken(): string {
  return randomBytes(32).toString("base64url");
}

function getNodeMajor(): number | null {
  const raw = process.versions.node?.split(".")[0];
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 180);
  }
  return "Telemetry heartbeat failed";
}

function getConfigTelemetry() {
  try {
    return loadConfig().config.telemetry ?? {};
  } catch {
    return {};
  }
}

async function loadSiteExtraSettings(): Promise<JsonRecord> {
  const settings = await db.siteSettings.findUnique({
    where: { id: SITE_SETTINGS_ID },
    select: { extraSettings: true },
  });
  return parseJsonObject(settings?.extraSettings);
}

async function writeSiteExtraSettings(extraSettings: JsonRecord): Promise<void> {
  await db.siteSettings.upsert({
    where: { id: SITE_SETTINGS_ID },
    update: { extraSettings: JSON.stringify(extraSettings) },
    create: {
      id: SITE_SETTINGS_ID,
      extraSettings: JSON.stringify(extraSettings),
    },
  });
}

function buildSettings(extra: JsonRecord): TelemetrySettingsInternal {
  const configTelemetry = getConfigTelemetry();
  const storedTelemetry = isRecord(extra.telemetry) ? extra.telemetry : {};
  const installProfile = isRecord(extra.installProfile) ? extra.installProfile : {};
  const disabledByEnv = toOptionalBoolean(process.env.SEQDESK_TELEMETRY_DISABLED) === true;

  const enabled =
    disabledByEnv
      ? false
      : toOptionalBoolean(storedTelemetry.enabled) ??
        toOptionalBoolean(configTelemetry.enabled) ??
        false;

  const endpoint = normalizeEndpoint(storedTelemetry.endpoint ?? configTelemetry.endpoint);
  const intervalHours = normalizeIntervalHours(
    storedTelemetry.intervalHours ?? configTelemetry.intervalHours
  );
  const instanceId = toOptionalString(storedTelemetry.instanceId) ?? null;
  const clientToken = toOptionalString(storedTelemetry.clientToken) ?? null;

  return {
    enabled,
    endpoint,
    intervalHours,
    instanceId,
    clientToken,
    clientTokenConfigured: Boolean(clientToken),
    installProfileId: toOptionalString(installProfile.id) ?? null,
    installProfileVersion: toOptionalString(installProfile.version) ?? null,
    lastSentAt: toOptionalString(storedTelemetry.lastSentAt) ?? null,
    lastError: toOptionalString(storedTelemetry.lastError) ?? null,
    lastStatus:
      typeof storedTelemetry.lastStatus === "number" &&
      Number.isFinite(storedTelemetry.lastStatus)
        ? Math.trunc(storedTelemetry.lastStatus)
        : null,
    promptDismissed: storedTelemetry.promptDismissed === true,
  };
}

async function loadTelemetrySettingsInternal(options?: {
  ensureIdentity?: boolean;
}): Promise<TelemetrySettingsInternal> {
  const extra = await loadSiteExtraSettings();
  let settings = buildSettings(extra);

  if (
    options?.ensureIdentity &&
    settings.enabled &&
    (!settings.instanceId || !settings.clientToken)
  ) {
    const telemetry = isRecord(extra.telemetry) ? { ...extra.telemetry } : {};
    telemetry.instanceId = settings.instanceId || randomUUID();
    telemetry.clientToken = settings.clientToken || generateClientToken();
    telemetry.createdAt = telemetry.createdAt || new Date().toISOString();
    extra.telemetry = telemetry;
    await writeSiteExtraSettings(extra);
    settings = buildSettings(extra);
  }

  return settings;
}

export async function getTelemetrySettings(): Promise<TelemetrySettingsView> {
  const settings = await loadTelemetrySettingsInternal();
  return {
    enabled: settings.enabled,
    endpoint: settings.endpoint,
    intervalHours: settings.intervalHours,
    instanceId: settings.instanceId,
    clientTokenConfigured: settings.clientTokenConfigured,
    installProfileId: settings.installProfileId,
    installProfileVersion: settings.installProfileVersion,
    lastSentAt: settings.lastSentAt,
    lastError: settings.lastError,
    lastStatus: settings.lastStatus,
    promptDismissed: settings.promptDismissed,
  };
}

export async function saveTelemetrySettings(input: {
  enabled?: unknown;
  endpoint?: unknown;
  intervalHours?: unknown;
  promptDismissed?: unknown;
}): Promise<TelemetrySettingsView> {
  const extra = await loadSiteExtraSettings();
  const existing = isRecord(extra.telemetry) ? { ...extra.telemetry } : {};

  const enabled = toOptionalBoolean(input.enabled);
  if (enabled !== undefined) {
    existing.enabled = enabled;
  }

  const promptDismissed = toOptionalBoolean(input.promptDismissed);
  if (promptDismissed !== undefined) {
    existing.promptDismissed = promptDismissed;
  }

  if (input.endpoint !== undefined) {
    const endpoint = toOptionalString(input.endpoint);
    if (!endpoint || !isValidEndpoint(endpoint)) {
      throw new Error("Telemetry endpoint must be an http or https URL");
    }
    existing.endpoint = normalizeEndpoint(endpoint);
  }

  if (input.intervalHours !== undefined) {
    const parsed = Number(input.intervalHours);
    if (
      !Number.isFinite(parsed) ||
      Math.trunc(parsed) < MIN_INTERVAL_HOURS ||
      Math.trunc(parsed) > MAX_INTERVAL_HOURS
    ) {
      throw new Error(
        `Telemetry interval must be between ${MIN_INTERVAL_HOURS} and ${MAX_INTERVAL_HOURS} hours`
      );
    }
    existing.intervalHours = Math.trunc(parsed);
  }

  if (existing.enabled === true) {
    existing.instanceId = toOptionalString(existing.instanceId) || randomUUID();
    existing.clientToken = toOptionalString(existing.clientToken) || generateClientToken();
    existing.createdAt = existing.createdAt || new Date().toISOString();
  }
  existing.updatedAt = new Date().toISOString();
  extra.telemetry = existing;
  await writeSiteExtraSettings(extra);

  return getTelemetrySettings();
}

async function updateStoredTelemetry(patch: JsonRecord): Promise<void> {
  const extra = await loadSiteExtraSettings();
  const telemetry = isRecord(extra.telemetry) ? { ...extra.telemetry } : {};
  extra.telemetry = {
    ...telemetry,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeSiteExtraSettings(extra);
}

export function buildTelemetryPayload(
  settings: Pick<TelemetrySettingsInternal, "instanceId" | "installProfileId" | "installProfileVersion">,
  context: TelemetryHeartbeatContext
): TelemetryHeartbeatPayload | null {
  if (!settings.instanceId) return null;

  return {
    protocolVersion: 1,
    instanceId: settings.instanceId,
    runningVersion: context.runningVersion,
    installedVersion: context.installedVersion || context.runningVersion,
    installProfile: {
      id: settings.installProfileId,
      version: settings.installProfileVersion,
    },
    update: {
      available: context.updateAvailable === true,
      latestVersion: context.latestVersion || null,
    },
    database: {
      provider: context.databaseProvider || "unknown",
    },
    runtime: {
      platform: os.platform(),
      arch: os.arch(),
      nodeMajor: getNodeMajor(),
    },
  };
}

export async function sendTelemetryHeartbeat(
  context: TelemetryHeartbeatContext,
  options?: { force?: boolean }
): Promise<TelemetrySendResult> {
  let settings: TelemetrySettingsInternal | null = null;

  try {
    settings = await loadTelemetrySettingsInternal({ ensureIdentity: true });
    if (!settings.enabled) {
      return { sent: false, reason: "disabled" };
    }
    if (!settings.instanceId || !settings.clientToken) {
      return { sent: false, reason: "missing-identity" };
    }
    if (!isValidEndpoint(settings.endpoint)) {
      return { sent: false, reason: "invalid-endpoint" };
    }

    const lastSentAt = settings.lastSentAt ? new Date(settings.lastSentAt).getTime() : 0;
    const throttleMs = settings.intervalHours * 60 * 60 * 1000;
    if (!options?.force && lastSentAt && Date.now() - lastSentAt < throttleMs) {
      return { sent: false, reason: "throttled", lastSentAt: settings.lastSentAt };
    }

    const payload = buildTelemetryPayload(settings, context);
    if (!payload) {
      return { sent: false, reason: "missing-identity" };
    }

    const response = await fetch(settings.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `SeqDesk/${context.runningVersion}`,
        "X-SeqDesk-Telemetry-Token": settings.clientToken,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const sentAt = new Date().toISOString();
    await updateStoredTelemetry({
      lastSentAt: sentAt,
      lastError: null,
      lastStatus: response.status,
    });

    return { sent: true, status: response.status, lastSentAt: sentAt };
  } catch (error) {
    const message = sanitizeError(error);
    if (settings?.enabled) {
      await updateStoredTelemetry({
        lastError: message,
        lastStatus: null,
      }).catch(() => undefined);
    }
    return { sent: false, reason: "failed", error: message };
  }
}
