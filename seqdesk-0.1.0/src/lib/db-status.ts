import { db } from "./db";

export type DatabaseStatus = {
  exists: boolean;
  configured: boolean;
  error?: string;
};

/**
 * Check if the database exists and is properly configured
 */
export async function checkDatabaseStatus(): Promise<DatabaseStatus> {
  try {
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

    // Check for common database errors
    if (
      errorMessage.includes("no such table") ||
      errorMessage.includes("does not exist") ||
      errorMessage.includes("SQLITE_ERROR")
    ) {
      return {
        exists: false,
        configured: false,
        error: "Database tables do not exist. Run migrations first.",
      };
    }

    if (
      errorMessage.includes("ENOENT") ||
      errorMessage.includes("unable to open database")
    ) {
      return {
        exists: false,
        configured: false,
        error: "Database file not found.",
      };
    }

    return {
      exists: false,
      configured: false,
      error: errorMessage,
    };
  }
}
