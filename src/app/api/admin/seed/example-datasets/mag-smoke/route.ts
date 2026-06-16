import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  getMagSmokeExampleStatus,
  seedMagSmokeExampleDataset,
} from "@/lib/seed/mag-smoke-example";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireFacilityAdmin() {
  const session = await getServerSession(authOptions);
  return session?.user?.role === "FACILITY_ADMIN";
}

export async function GET() {
  if (!(await requireFacilityAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await getMagSmokeExampleStatus());
}

export async function POST() {
  if (!(await requireFacilityAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await seedMagSmokeExampleDataset();
    const status = await getMagSmokeExampleStatus();
    return NextResponse.json({ success: true, result, status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to seed the MAG smoke example dataset";
    console.error("[MAG smoke example seed] Failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
