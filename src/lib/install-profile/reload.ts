import { spawn } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import {
  ARRAY_INSTALL_PROFILE_SECTIONS,
  INSTALL_ONLY_PROFILE_SECTIONS,
  KNOWN_INSTALL_PROFILE_SECTIONS,
  STRUCTURED_INSTALL_PROFILE_SECTIONS,
  UNSUPPORTED_PROFILE_SECTIONS,
} from "@/lib/install-profile/coverage";

export type AppliedInstallProfileSummary = {
  id?: string;
  name?: string;
  version?: string;
  minSeqDeskVersion?: string;
};

export type ReloadHostedInstallProfileInput = {
  profileId: string;
  profileCode?: string;
  profileRegistryUrl?: string;
  includeAssets?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export type ReloadHostedInstallProfileResult = {
  profile: AppliedInstallProfileSummary;
  includeAssets: boolean;
  validation: InstallProfileValidationSummary;
  settings: ScriptRunSummary;
  assets?: ScriptRunSummary;
};

export type ScriptRunSummary = {
  script: string;
  stdout: string;
  stderr: string;
};

export type InstallProfileValidationSummary = {
  warnings: string[];
  ignoredSections: string[];
  appliedSections: string[];
};

const DEFAULT_PROFILE_REGISTRY_URL = "https://seqdesk.org/api/install-profiles";
const MAX_CAPTURED_OUTPUT_CHARS = 20_000;
const RELOAD_LOCK_FILE = ".install-profile-reload.lock";
const RELOAD_LOCK_STALE_MS = 60 * 60 * 1000;
const RELOAD_LOCK_HEARTBEAT_MS = 5 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeProfileId(profileId: string): string {
  return profileId.trim();
}

export function profileCodeEnvName(profileId: string): string {
  return `${profileId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_SETUP_CODE`;
}

export function resolveProfileCodeFromEnv(
  profileId: string,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  return (
    readString(env.SEQDESK_PROFILE_CODE) ||
    readString(env.SEQDESK_KEY) ||
    readString(env[profileCodeEnvName(profileId)])
  );
}

export function defaultProfileRegistryUrl(): string {
  return readString(process.env.SEQDESK_PROFILE_REGISTRY_URL) || DEFAULT_PROFILE_REGISTRY_URL;
}

export function summarizeInstallProfile(profile: unknown): AppliedInstallProfileSummary {
  const record = isRecord(profile) ? profile : {};
  const profileInfo = isRecord(record.profile) ? record.profile : {};
  return {
    ...(readString(record.id) ? { id: readString(record.id) } : {}),
    ...(readString(profileInfo.name) || readString(record.name)
      ? { name: readString(profileInfo.name) || readString(record.name) }
      : {}),
    ...(readString(record.version) ? { version: readString(record.version) } : {}),
    ...(readString(record.minSeqDeskVersion)
      ? { minSeqDeskVersion: readString(record.minSeqDeskVersion) }
      : {}),
  };
}

function redactOutput(value: string, secrets: string[]): string {
  let next = value.replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]");
  for (const secret of secrets) {
    if (!secret) continue;
    next = next.split(secret).join("[redacted]");
  }
  if (next.length > MAX_CAPTURED_OUTPUT_CHARS) {
    return `${next.slice(0, MAX_CAPTURED_OUTPUT_CHARS)}\n[output truncated]`;
  }
  return next;
}

function isLocalhost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function registryOrigin(value: string): string {
  return new URL(value).origin;
}

function configuredRegistryAllowlist(): Set<string> {
  const origins = new Set<string>([registryOrigin(DEFAULT_PROFILE_REGISTRY_URL)]);
  const configuredDefault = readString(process.env.SEQDESK_PROFILE_REGISTRY_URL);
  if (configuredDefault) {
    try {
      origins.add(registryOrigin(configuredDefault));
    } catch {
      // validateRegistryUrl will surface invalid configured defaults where used.
    }
  }
  const rawAllowlist = readString(process.env.SEQDESK_PROFILE_REGISTRY_ALLOWLIST);
  for (const item of rawAllowlist?.split(",") || []) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    try {
      origins.add(registryOrigin(trimmed));
    } catch {
      origins.add(trimmed.replace(/\/+$/, ""));
    }
  }
  return origins;
}

function validateRegistryUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid hosted profile registry URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Unsupported hosted profile registry protocol: ${parsed.protocol}`);
  }
  if (parsed.protocol === "http:" && !isLocalhost(parsed.hostname)) {
    throw new Error("Hosted profile registry URL must use HTTPS");
  }
  if (!configuredRegistryAllowlist().has(parsed.origin)) {
    throw new Error(`Hosted profile registry origin is not allowed: ${parsed.origin}`);
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed;
}

function resolveProfileUrl(registryUrl: string, profileId: string): string {
  const parsed = validateRegistryUrl(registryUrl);
  parsed.pathname = `${parsed.pathname}/${encodeURIComponent(profileId)}/resolve`;
  return parsed.toString();
}

async function resolveHostedProfile({
  profileId,
  profileCode,
  profileRegistryUrl,
}: {
  profileId: string;
  profileCode: string;
  profileRegistryUrl: string;
}): Promise<Record<string, unknown>> {
  const response = await fetch(resolveProfileUrl(profileRegistryUrl, profileId), {
    headers: {
      authorization: `Bearer ${profileCode}`,
      accept: "application/json",
      "user-agent": "SeqDesk hosted-profile-reload",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(
      payload?.error || `Hosted profile resolve failed with HTTP ${response.status}`
    );
  }

  const profile = (await response.json()) as unknown;
  if (!isRecord(profile)) {
    throw new Error("Hosted profile resolver returned an invalid JSON payload");
  }
  return profile;
}

function readPackageVersion(cwd: string): string {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf8")
    ) as unknown;
    if (isRecord(parsed)) {
      return readString(parsed.version) || "0.0.0";
    }
  } catch {
    // Fall through to a conservative fallback. The caller still validates profile shape.
  }
  return "0.0.0";
}

type ComparableVersion = {
  core: [number, number, number];
  prerelease: string[];
};

const SEMVER_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseVersion(value: string): ComparableVersion | null {
  const match = value.trim().match(SEMVER_PATTERN);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrereleaseIdentifiers(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    return Number(left) - Number(right);
  }
  if (leftNumeric !== rightNumeric) {
    return leftNumeric ? -1 : 1;
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareVersions(left: ComparableVersion, right: ComparableVersion): number {
  for (let index = 0; index < 3; index += 1) {
    const diff = left.core[index] - right.core[index];
    if (diff !== 0) return diff;
  }

  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === undefined ? -1 : 1;
    }
    const diff = comparePrereleaseIdentifiers(leftIdentifier, rightIdentifier);
    if (diff !== 0) return diff;
  }
  return 0;
}

function validateResolvedInstallProfile({
  profile,
  requestedProfileId,
  cwd,
}: {
  profile: Record<string, unknown>;
  requestedProfileId: string;
  cwd: string;
}): InstallProfileValidationSummary {
  const resolvedId = readString(profile.id);
  if (!resolvedId) {
    throw new Error("Hosted profile resolver returned a profile without an id");
  }
  if (resolvedId !== requestedProfileId) {
    throw new Error(
      `Hosted profile id mismatch: requested ${requestedProfileId}, resolved ${resolvedId}`
    );
  }

  const minSeqDeskVersion = readString(profile.minSeqDeskVersion);
  if (profile.minSeqDeskVersion !== undefined) {
    if (!minSeqDeskVersion) {
      throw new Error(
        "Hosted profile minSeqDeskVersion must be a semantic version such as 1.2.3"
      );
    }
    const currentVersion = readPackageVersion(cwd);
    const parsedMinimumVersion = parseVersion(minSeqDeskVersion);
    if (!parsedMinimumVersion) {
      throw new Error(
        "Hosted profile minSeqDeskVersion must be a semantic version such as 1.2.3"
      );
    }
    const parsedCurrentVersion = parseVersion(currentVersion);
    if (!parsedCurrentVersion) {
      throw new Error(`Installed SeqDesk version is not valid semantic version: ${currentVersion}`);
    }
    if (compareVersions(parsedCurrentVersion, parsedMinimumVersion) < 0) {
      throw new Error(
        `Hosted profile ${resolvedId} requires SeqDesk ${minSeqDeskVersion}+; this install is ${currentVersion}`
      );
    }
  }

  const warnings: string[] = [];
  const ignoredSections: string[] = [];
  const appliedSections: string[] = [];

  for (const [key, value] of Object.entries(profile)) {
    if (!KNOWN_INSTALL_PROFILE_SECTIONS.has(key)) {
      ignoredSections.push(key);
      warnings.push(`Unknown hosted profile section ignored: ${key}`);
      continue;
    }
    if (STRUCTURED_INSTALL_PROFILE_SECTIONS.has(key) && value !== undefined && !isRecord(value)) {
      throw new Error(`Hosted profile section ${key} must be a JSON object`);
    }
    if (ARRAY_INSTALL_PROFILE_SECTIONS.has(key) && value !== undefined && !Array.isArray(value)) {
      throw new Error(`Hosted profile section ${key} must be a JSON array`);
    }
    if (
      [
        "access",
        "auth",
        "ena",
        "forms",
        "moduleSettings",
        "modules",
        "notifications",
        "pipelineSmokeTests",
        "pipelines",
        "seedData",
        "sequencingFiles",
        "sequencingTech",
        "site",
        "studies",
        "telemetry",
      ].includes(key)
    ) {
      appliedSections.push(key);
    } else if (INSTALL_ONLY_PROFILE_SECTIONS.has(key)) {
      ignoredSections.push(key);
      warnings.push(`Hosted profile section is install-time only during reload: ${key}`);
    } else if (UNSUPPORTED_PROFILE_SECTIONS.has(key)) {
      ignoredSections.push(key);
      warnings.push(`Hosted profile section is not supported during reload: ${key}`);
    }
  }

  return {
    warnings,
    ignoredSections: Array.from(new Set(ignoredSections)).sort(),
    appliedSections: Array.from(new Set(appliedSections)).sort(),
  };
}

type ReloadLockSnapshot = {
  contents: string;
  device: number;
  inode: number;
  modifiedAtMs: number;
  size: number;
};

async function readReloadLockSnapshot(lockPath: string): Promise<ReloadLockSnapshot | null> {
  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(lockPath, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const stat = await handle.stat();
    return {
      contents: await handle.readFile("utf8"),
      device: stat.dev,
      inode: stat.ino,
      modifiedAtMs: stat.mtimeMs,
      size: stat.size,
    };
  } finally {
    await handle.close();
  }
}

function isSameReloadLock(
  observed: ReloadLockSnapshot,
  candidate: ReloadLockSnapshot
): boolean {
  return (
    observed.device === candidate.device &&
    observed.inode === candidate.inode &&
    observed.modifiedAtMs === candidate.modifiedAtMs &&
    observed.size === candidate.size &&
    observed.contents === candidate.contents
  );
}

async function restoreQuarantinedReloadLock(
  lockPath: string,
  quarantinePath: string
): Promise<void> {
  try {
    await fsp.link(quarantinePath, lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return;
    }
    throw error;
  }
  await fsp.rm(quarantinePath, { force: true });
}

async function reclaimStaleReloadLock(
  lockPath: string,
  observed: ReloadLockSnapshot
): Promise<boolean> {
  const quarantinePath = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
  try {
    await fsp.rename(lockPath, quarantinePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return true;
    }
    throw error;
  }

  const quarantined = await readReloadLockSnapshot(quarantinePath);
  if (!quarantined || !isSameReloadLock(observed, quarantined)) {
    await restoreQuarantinedReloadLock(lockPath, quarantinePath);
    return false;
  }

  await fsp.rm(quarantinePath, { force: true });
  return true;
}

async function acquireReloadLock(cwd: string, profileId: string): Promise<() => Promise<void>> {
  const lockPath = path.join(cwd, "pipelines", RELOAD_LOCK_FILE);
  const ownerToken = randomUUID();
  await fsp.mkdir(path.dirname(lockPath), { recursive: true });
  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(lockPath, "wx", 0o600);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      const observed = await readReloadLockSnapshot(lockPath);
      if (observed && Date.now() - observed.modifiedAtMs > RELOAD_LOCK_STALE_MS) {
        if (await reclaimStaleReloadLock(lockPath, observed)) {
          return acquireReloadLock(cwd, profileId);
        }
      }
      throw new Error("A hosted profile reload is already running");
    }
    throw error;
  }
  await handle.writeFile(
    JSON.stringify(
      {
        profileId,
        ownerToken,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  await handle.close();

  const stillOwnsLock = async (): Promise<boolean> => {
    try {
      const current = JSON.parse(await fsp.readFile(lockPath, "utf8"));
      return isRecord(current) && current.ownerToken === ownerToken;
    } catch {
      return false;
    }
  };
  const heartbeat = setInterval(() => {
    void (async () => {
      if (await stillOwnsLock()) {
        const now = new Date();
        await fsp.utimes(lockPath, now, now).catch(() => undefined);
      }
    })();
  }, RELOAD_LOCK_HEARTBEAT_MS);
  heartbeat.unref();

  return async () => {
    clearInterval(heartbeat);
    if (await stillOwnsLock()) {
      await fsp.rm(lockPath, { force: true });
    }
  };
}

async function writeTempProfile(profile: Record<string, unknown>): Promise<{
  tempDir: string;
  profilePath: string;
}> {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "seqdesk-profile-reload-"));
  const profilePath = path.join(tempDir, "profile.json");
  await fsp.writeFile(profilePath, JSON.stringify(profile), { mode: 0o600 });
  return { tempDir, profilePath };
}

async function runNodeScript({
  cwd,
  script,
  args,
  secrets,
  env,
}: {
  cwd: string;
  script: string;
  args: string[];
  secrets: string[];
  env: NodeJS.ProcessEnv;
}): Promise<ScriptRunSummary> {
  const scriptPath = path.join(cwd, script);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Installed app is missing ${script}`);
  }

  const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [scriptPath, ...args], {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code, signal) => {
        if (signal) {
          reject(new Error(`${script} exited with signal ${signal}`));
          return;
        }
        if (code !== 0) {
          reject(
            new Error(
              `${script} exited with code ${code ?? "unknown"}${
                stderr.trim() ? `: ${redactOutput(stderr.trim(), secrets)}` : ""
              }`
            )
          );
          return;
        }
        resolve({ stdout, stderr });
      });
    }
  );

  return {
    script,
    stdout: redactOutput(stdout.trim(), secrets),
    stderr: redactOutput(stderr.trim(), secrets),
  };
}

export async function reloadHostedInstallProfile(
  input: ReloadHostedInstallProfileInput
): Promise<ReloadHostedInstallProfileResult> {
  const profileId = sanitizeProfileId(input.profileId);
  if (!profileId) {
    throw new Error("Profile id is required");
  }

  const cwd = path.resolve(input.cwd || process.cwd());
  const profileCode =
    readString(input.profileCode) || resolveProfileCodeFromEnv(profileId, input.env);
  if (!profileCode) {
    throw new Error(
      `Profile access code is required, or set SEQDESK_PROFILE_CODE, SEQDESK_KEY, or ${profileCodeEnvName(profileId)}`
    );
  }

  const defaultRegistryUrl = defaultProfileRegistryUrl();
  const profileRegistryUrl = readString(input.profileRegistryUrl) || defaultRegistryUrl;
  const isNonDefaultRegistry =
    validateRegistryUrl(profileRegistryUrl).origin !== validateRegistryUrl(defaultRegistryUrl).origin;
  const includeAssets = input.includeAssets === true;
  if (isNonDefaultRegistry && !readString(input.profileCode)) {
    throw new Error(
      "Explicit profile access code is required when using a non-default profile registry"
    );
  }
  const releaseLock = await acquireReloadLock(cwd, profileId);
  let tempDir: string | undefined;
  try {
    const profile = await resolveHostedProfile({
      profileId,
      profileCode,
      profileRegistryUrl,
    });
    const validation = validateResolvedInstallProfile({
      profile,
      requestedProfileId: profileId,
      cwd,
    });

    const tempProfile = await writeTempProfile(profile);
    tempDir = tempProfile.tempDir;
    const profilePath = tempProfile.profilePath;
    const secrets = [profileCode];
    const settings = await runNodeScript({
      cwd,
      script: path.join("scripts", "apply-install-profile.mjs"),
      args: ["--profile-config", profilePath],
      secrets,
      env: input.env || process.env,
    });

    const assets = includeAssets
      ? await runNodeScript({
          cwd,
          script: path.join("scripts", "apply-install-profile-assets.mjs"),
          args: ["--profile-config", profilePath, "--json"],
          secrets,
          env: input.env || process.env,
        })
      : undefined;

    return {
      profile: summarizeInstallProfile(profile),
      includeAssets,
      validation,
      settings,
      ...(assets ? { assets } : {}),
    };
  } finally {
    if (tempDir) {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
    await releaseLock();
  }
}
