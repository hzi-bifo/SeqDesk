import { bootstrapRuntimeEnv } from "@/lib/config/runtime-env";
import { getDatabaseConfigurationError } from "@/lib/database-url";

bootstrapRuntimeEnv();

export type DatabaseStatus = {
  exists: boolean;
  configured: boolean;
  error?: string;
};

/**
 * Check if the database exists and is properly configured
 */
export async function checkDatabaseStatus(): Promise<DatabaseStatus> {
  const configurationError = getDatabaseConfigurationError(process.env.DATABASE_URL);
  if (configurationError) {
    return {
      exists: false,
      configured: false,
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
        error: "Database exists but has not been seeded with initial data.",
      };
    }

    return {
      exists: true,
      configured: true,
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
        error: "Database schema is missing. Run `npm run db:migrate:deploy` first.",
      };
    }

    return {
      exists: false,
      configured: false,
      error: errorMessage,
    };
  }
}
