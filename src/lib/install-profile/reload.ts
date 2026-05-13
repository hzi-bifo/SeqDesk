import { spawn } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";

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
  settings: ScriptRunSummary;
  assets?: ScriptRunSummary;
};

export type ScriptRunSummary = {
  script: string;
  stdout: string;
  stderr: string;
};

const DEFAULT_PROFILE_REGISTRY_URL = "https://www.seqdesk.com/api/install-profiles";
const MAX_CAPTURED_OUTPUT_CHARS = 20_000;

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

  const profileRegistryUrl =
    readString(input.profileRegistryUrl) || defaultProfileRegistryUrl();
  const includeAssets = input.includeAssets === true;
  const profile = await resolveHostedProfile({
    profileId,
    profileCode,
    profileRegistryUrl,
  });

  const { tempDir, profilePath } = await writeTempProfile(profile);
  const secrets = [profileCode];
  try {
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
      settings,
      ...(assets ? { assets } : {}),
    };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}
