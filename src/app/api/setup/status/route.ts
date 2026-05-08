import { NextResponse } from "next/server";
import { checkDatabaseStatus } from "@/lib/db-status";
import { buildSetupStatusResponse } from "@/lib/setup-status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  let status = await checkDatabaseStatus();
  let seedError: string | undefined;
  let seedInProgress = false;

  // Auto-seed if database exists but hasn't been seeded
  if (status.exists && !status.configured) {
    try {
      const { autoSeedIfNeeded } = await import("@/lib/auto-seed");
      const result = await autoSeedIfNeeded();
      if (result.seeded) {
        // Re-check status after seeding
        status = await checkDatabaseStatus();
      } else if (result.error) {
        seedError = result.error;
        seedInProgress = result.error === "Seeding already in progress";
      }
    } catch (error) {
      seedError =
        error instanceof Error ? error.message : "Automatic seeding failed";
    }
  }

  return NextResponse.json(
    buildSetupStatusResponse(status, {
      ...(seedError ? { seedError } : {}),
      ...(seedInProgress ? { seedInProgress } : {}),
    }),
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
