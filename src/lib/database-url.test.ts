import { describe, expect, it } from "vitest";

import {
  POSTGRES_PROTOCOLS,
  detectDatabaseHosting,
  detectDatabaseProvider,
  getDatabaseConfigurationError,
  isNeonDatabaseUrl,
  isPooledDatabaseUrl,
  isPostgresDatabaseUrl,
  isSqliteDatabaseUrl,
  normalizeDatabaseUrl,
  requirePostgresDatabaseUrl,
  resolveDirectUrl,
} from "./database-url";

describe("database-url", () => {
  it("normalizes database URLs and recognizes supported protocols", () => {
    expect(POSTGRES_PROTOCOLS).toEqual(["postgresql://", "postgres://"]);
    expect(normalizeDatabaseUrl(undefined)).toBeNull();
    expect(normalizeDatabaseUrl(null)).toBeNull();
    expect(normalizeDatabaseUrl("   ")).toBeNull();
    expect(normalizeDatabaseUrl("  postgres://seqdesk/db  ")).toBe(
      "postgres://seqdesk/db"
    );

    expect(isSqliteDatabaseUrl(" file:./dev.db ")).toBe(true);
    expect(isSqliteDatabaseUrl("postgres://seqdesk/db")).toBe(false);
    expect(isPostgresDatabaseUrl("postgres://seqdesk/db")).toBe(true);
    expect(isPostgresDatabaseUrl("postgresql://seqdesk/db")).toBe(true);
    expect(isPostgresDatabaseUrl("mysql://seqdesk/db")).toBe(false);
  });

  it("detects the configured database provider", () => {
    expect(detectDatabaseProvider("postgres://seqdesk/db")).toBe("postgresql");
    expect(detectDatabaseProvider("file:./dev.db")).toBe("sqlite");
    expect(detectDatabaseProvider("mysql://seqdesk/db")).toBe("unknown");
    expect(detectDatabaseProvider("   ")).toBe("unknown");
  });

  it("detects database hosting separately from SQL engine compatibility", () => {
    const neonDirect =
      "postgresql://user:pass@ep-silent-cell-a1b2c3d4.us-east-1.aws.neon.tech/neondb?sslmode=require";
    const neonPooled =
      "postgresql://user:pass@ep-silent-cell-a1b2c3d4-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
    const localPostgres =
      "postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk?schema=public";

    expect(detectDatabaseProvider(neonDirect)).toBe("postgresql");
    expect(detectDatabaseHosting(neonDirect)).toBe("neon");
    expect(isNeonDatabaseUrl(neonDirect)).toBe(true);
    expect(isPooledDatabaseUrl(neonDirect)).toBe(false);

    expect(detectDatabaseHosting(neonPooled)).toBe("neon");
    expect(isPooledDatabaseUrl(neonPooled)).toBe(true);

    expect(detectDatabaseHosting(localPostgres)).toBe("self-hosted-postgres");
    expect(isNeonDatabaseUrl(localPostgres)).toBe(false);
    expect(isPooledDatabaseUrl(localPostgres)).toBe(false);
    expect(detectDatabaseHosting("file:./dev.db")).toBe("unknown");
  });

  it("reports configuration errors for missing and unsupported URLs", () => {
    expect(getDatabaseConfigurationError(undefined)).toBe(
      "DATABASE_URL is not configured. SeqDesk now requires a PostgreSQL connection string."
    );
    expect(getDatabaseConfigurationError("file:./dev.db")).toBe(
      "SQLite is no longer supported. Configure PostgreSQL via DATABASE_URL. Use DIRECT_URL for migrations if your runtime URL is pooled."
    );
    expect(getDatabaseConfigurationError("mysql://seqdesk/db")).toBe(
      "Unsupported DATABASE_URL. SeqDesk now only supports PostgreSQL connection strings."
    );
    expect(getDatabaseConfigurationError("postgres://seqdesk/db")).toBeNull();
  });

  it("requires a valid PostgreSQL URL and returns the trimmed value", () => {
    expect(requirePostgresDatabaseUrl("  postgres://seqdesk/db  ")).toBe(
      "postgres://seqdesk/db"
    );
    expect(() => requirePostgresDatabaseUrl("file:./dev.db")).toThrow(
      "SQLite is no longer supported. Configure PostgreSQL via DATABASE_URL. Use DIRECT_URL for migrations if your runtime URL is pooled."
    );
  });

  it("prefers DIRECT_URL and falls back to DATABASE_URL", () => {
    expect(resolveDirectUrl("postgres://primary/db", " postgres://direct/db ")).toBe(
      "postgres://direct/db"
    );
    expect(resolveDirectUrl(" postgres://primary/db ", "   ")).toBe(
      "postgres://primary/db"
    );
    expect(resolveDirectUrl("   ", undefined)).toBeNull();
  });
});
