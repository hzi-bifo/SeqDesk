import { NextResponse } from "next/server";
import { checkDatabaseStatus } from "@/lib/db-status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  let status = await checkDatabaseStatus();

  // Auto-seed if database exists but hasn't been seeded
  if (status.exists && !status.configured) {
    try {
      const { autoSeedIfNeeded } = await import("@/lib/auto-seed");
      const result = await autoSeedIfNeeded();
      if (result.seeded) {
        // Re-check status after seeding
        status = await checkDatabaseStatus();
      } else if (result.error) {
        status = {
          ...status,
          error: result.error,
        };
      }
    } catch (error) {
      status = {
        ...status,
        error: error instanceof Error ? error.message : "Automatic seeding failed",
      };
    }
  }

  return NextResponse.json(status, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
