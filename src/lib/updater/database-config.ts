import fs from "fs/promises";
import path from "path";
import { bootstrapRuntimeEnv } from "@/lib/config/runtime-env";
import {
  detectDatabaseProvider,
  resolveDirectUrl,
  type DatabaseProvider,
} from "@/lib/database-url";

export interface InstalledDatabaseConfig {
  databaseUrl: string | null;
  directUrl: string | null;
  provider: DatabaseProvider;
}

export async function loadInstalledDatabaseConfig(
  baseDir: string = process.cwd()
): Promise<InstalledDatabaseConfig> {
  bootstrapRuntimeEnv(baseDir);

  let databaseUrl =
    typeof process.env.DATABASE_URL === "string" &&
    process.env.DATABASE_URL.trim().length > 0
      ? process.env.DATABASE_URL.trim()
      : null;
  let directUrl =
    typeof process.env.DIRECT_URL === "string" &&
    process.env.DIRECT_URL.trim().length > 0
      ? process.env.DIRECT_URL.trim()
      : null;

  if (!databaseUrl || !directUrl) {
    try {
      const configPath = path.join(baseDir, "seqdesk.config.json");
      const parsed = JSON.parse(await fs.readFile(configPath, "utf8")) as {
        runtime?: { databaseUrl?: unknown; directUrl?: unknown };
      };

      const runtime =
        parsed.runtime && typeof parsed.runtime === "object"
          ? parsed.runtime
          : undefined;

      const configDatabaseUrl =
        typeof runtime?.databaseUrl === "string" &&
        runtime.databaseUrl.trim().length > 0
          ? runtime.databaseUrl.trim()
          : null;
      const configDirectUrl =
        typeof runtime?.directUrl === "string" &&
        runtime.directUrl.trim().length > 0
          ? runtime.directUrl.trim()
          : null;

      databaseUrl = databaseUrl || configDatabaseUrl;
      directUrl = directUrl || configDirectUrl;
    } catch {
      // Ignore missing or invalid config and return env-only values.
    }
  }

  directUrl = resolveDirectUrl(databaseUrl, directUrl);

  return {
    databaseUrl,
    directUrl,
    provider: detectDatabaseProvider(databaseUrl),
  };
}

export function getDatabaseCompatibilityError(
  currentProvider: DatabaseProvider,
  releaseRequirement?: "postgresql"
): string | undefined {
  if (!releaseRequirement) {
    return undefined;
  }

  if (releaseRequirement === "postgresql" && currentProvider !== "postgresql") {
    return "This release requires PostgreSQL. Existing SQLite installs must stay on the last SQLite-compatible release until they are migrated manually.";
  }

  return undefined;
}
