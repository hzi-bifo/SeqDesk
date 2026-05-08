import { bootstrapRuntimeEnv } from "@/lib/config/runtime-env";
import { getDatabaseConfigurationError } from "@/lib/database-url";

bootstrapRuntimeEnv();

export type DatabaseStatusReason =
  | "configured"
  | "not_configured"
  | "legacy_sqlite"
  | "unsupported_url"
  | "unreachable"
  | "schema_missing"
  | "not_seeded"
  | "unknown";

export type InstallProfileMetadata = {
  id?: string;
  name?: string;
  version?: string;
  appliedAt?: string;
  source: "database" | "config";
};

export type DatabaseStatus = {
  exists: boolean;
  configured: boolean;
  reason: DatabaseStatusReason;
  error?: string;
  installProfile?: InstallProfileMetadata;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseInstallProfileFromExtraSettings(
  raw: unknown
): InstallProfileMetadata | undefined {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const extra = isRecord(parsed) ? parsed : {};
    const profile = isRecord(extra.installProfile) ? extra.installProfile : {};
    const id = readString(profile.id);
    const name = readString(profile.name);
    const version = readString(profile.version);
    const appliedAt = readString(profile.appliedAt);

    if (!id && !name && !version && !appliedAt) {
      return undefined;
    }

    return {
      ...(id ? { id } : {}),
      ...(name ? { name } : {}),
      ...(version ? { version } : {}),
      ...(appliedAt ? { appliedAt } : {}),
      source: "database",
    };
  } catch {
    return undefined;
  }
}

function classifyConfigurationError(error: string): DatabaseStatusReason {
  if (error.includes("DATABASE_URL is not configured")) {
    return "not_configured";
  }

  if (error.includes("SQLite is no longer supported")) {
    return "legacy_sqlite";
  }

  if (error.includes("Unsupported DATABASE_URL")) {
    return "unsupported_url";
  }

  return "unknown";
}

/**
 * Check if the database exists and is properly configured
 */
export async function checkDatabaseStatus(): Promise<DatabaseStatus> {
  const configurationError = getDatabaseConfigurationError(process.env.DATABASE_URL);
  if (configurationError) {
    return {
      exists: false,
      configured: false,
      reason: classifyConfigurationError(configurationError),
      error: configurationError,
    };
  }

  try {
    const { db } = await import("./db");

    // Try to query the SiteSettings table - this should exist if DB is set up
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
    });

    if (!settings) {
      // Database exists but hasn't been seeded
      return {
        exists: true,
        configured: false,
        reason: "not_seeded",
        error: "Database exists but has not been seeded with initial data.",
      };
    }

    return {
      exists: true,
      configured: true,
      reason: "configured",
      installProfile: parseInstallProfileFromExtraSettings(settings.extraSettings),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (
      errorMessage.includes("P1001") ||
      errorMessage.includes("Can't reach database server") ||
      errorMessage.includes("connection") ||
      errorMessage.includes("connect")
    ) {
      return {
        exists: false,
        configured: false,
        reason: "unreachable",
        error:
          "PostgreSQL is unreachable. Verify DATABASE_URL and DIRECT_URL, then retry.",
      };
    }

    if (
      errorMessage.includes("no such table") ||
      errorMessage.includes("does not exist") ||
      errorMessage.includes("SQLITE_ERROR") ||
      errorMessage.includes("The table")
    ) {
      return {
        exists: false,
        configured: false,
        reason: "schema_missing",
        error: "Database schema is missing. Run `npm run db:migrate:deploy` first.",
      };
    }

    return {
      exists: false,
      configured: false,
      reason: "unknown",
      error: errorMessage,
    };
  }
}
