export const POSTGRES_PROTOCOLS = ["postgresql://", "postgres://"] as const;
export type DatabaseProvider = "postgresql" | "sqlite" | "unknown";

export function normalizeDatabaseUrl(
  value: string | null | undefined
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isSqliteDatabaseUrl(value: string | null | undefined): boolean {
  const normalized = normalizeDatabaseUrl(value);
  return normalized?.startsWith("file:") ?? false;
}

export function isPostgresDatabaseUrl(value: string | null | undefined): boolean {
  const normalized = normalizeDatabaseUrl(value);
  if (!normalized) {
    return false;
  }

  return POSTGRES_PROTOCOLS.some((protocol) => normalized.startsWith(protocol));
}

export function detectDatabaseProvider(
  value: string | null | undefined
): DatabaseProvider {
  if (isPostgresDatabaseUrl(value)) {
    return "postgresql";
  }

  if (isSqliteDatabaseUrl(value)) {
    return "sqlite";
  }

  return "unknown";
}

export function getDatabaseConfigurationError(
  value: string | null | undefined
): string | null {
  const normalized = normalizeDatabaseUrl(value);

  if (!normalized) {
    return "DATABASE_URL is not configured. SeqDesk now requires a PostgreSQL connection string.";
  }

  if (isSqliteDatabaseUrl(normalized)) {
    return "SQLite is no longer supported. Configure PostgreSQL via DATABASE_URL. Use DIRECT_URL for migrations if your runtime URL is pooled.";
  }

  if (!isPostgresDatabaseUrl(normalized)) {
    return "Unsupported DATABASE_URL. SeqDesk now only supports PostgreSQL connection strings.";
  }

  return null;
}

export function requirePostgresDatabaseUrl(
  value: string | null | undefined
): string {
  const error = getDatabaseConfigurationError(value);
  if (error) {
    throw new Error(error);
  }

  return value!.trim();
}

export function resolveDirectUrl(
  databaseUrl: string | null | undefined,
  directUrl: string | null | undefined
): string | null {
  return normalizeDatabaseUrl(directUrl) || normalizeDatabaseUrl(databaseUrl);
}
