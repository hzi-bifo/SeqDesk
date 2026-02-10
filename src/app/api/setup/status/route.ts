import { NextResponse } from "next/server";
import { checkDatabaseStatus } from "@/lib/db-status";
import { autoSeedIfNeeded } from "@/lib/auto-seed";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  let status = await checkDatabaseStatus();

  // Auto-seed if database exists but hasn't been seeded
  if (status.exists && !status.configured) {
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
  }

  return NextResponse.json(status, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
