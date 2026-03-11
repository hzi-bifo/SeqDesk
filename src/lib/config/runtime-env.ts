import fs from "fs";
import path from "path";

const CONFIG_FILE_NAMES = [
  "seqdesk.config.json",
  ".seqdeskrc",
  ".seqdeskrc.json",
];

interface RuntimeConfig {
  databaseUrl?: string;
  directUrl?: string;
  nextAuthUrl?: string;
  nextAuthSecret?: string;
  anthropicApiKey?: string;
  adminSecret?: string;
  blobReadWriteToken?: string;
  updateServer?: string;
}

interface RuntimeConfigFile {
  runtime?: RuntimeConfig;
}

declare global {
  var __seqdeskRuntimeEnvBootstrapped: boolean | undefined;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function applyIfMissing(envKey: string, value: unknown): void {
  if (process.env[envKey]) {
    return;
  }
  const parsed = toOptionalString(value);
  if (parsed) {
    process.env[envKey] = parsed;
  }
}

function findConfigPath(baseDir: string): string | null {
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(baseDir, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function bootstrapRuntimeEnv(baseDir: string = process.cwd()): void {
  if (globalThis.__seqdeskRuntimeEnvBootstrapped) {
    return;
  }
  globalThis.__seqdeskRuntimeEnvBootstrapped = true;

  const configPath = findConfigPath(baseDir);
  if (!configPath) {
    return;
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(content) as RuntimeConfigFile;
    const runtime = parsed.runtime;
    if (!runtime || typeof runtime !== "object") {
      return;
    }

    const runtimeDatabaseUrl = toOptionalString(runtime.databaseUrl);
    const runtimeDirectUrl = toOptionalString(runtime.directUrl);
    const envDatabaseUrl = toOptionalString(process.env.DATABASE_URL);
    const envDirectUrl = toOptionalString(process.env.DIRECT_URL);

    if (!envDatabaseUrl && runtimeDatabaseUrl) {
      process.env.DATABASE_URL = runtimeDatabaseUrl;
    }

    if (!envDirectUrl) {
      if (envDatabaseUrl) {
        // Keep the migration URL aligned when the runtime DB URL is overridden via env.
        process.env.DIRECT_URL = envDatabaseUrl;
      } else if (runtimeDirectUrl) {
        process.env.DIRECT_URL = runtimeDirectUrl;
      } else if (process.env.DATABASE_URL) {
        process.env.DIRECT_URL = process.env.DATABASE_URL;
      }
    }
    applyIfMissing("NEXTAUTH_URL", runtime.nextAuthUrl);
    applyIfMissing("NEXTAUTH_SECRET", runtime.nextAuthSecret);
    applyIfMissing("ANTHROPIC_API_KEY", runtime.anthropicApiKey);
    applyIfMissing("ADMIN_SECRET", runtime.adminSecret);
    applyIfMissing("BLOB_READ_WRITE_TOKEN", runtime.blobReadWriteToken);
    applyIfMissing("SEQDESK_UPDATE_SERVER", runtime.updateServer);
  } catch {
    // Ignore invalid JSON and keep default environment behavior.
  }
}
