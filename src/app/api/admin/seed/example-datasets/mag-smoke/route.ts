import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";
import {
  getMagSmokeExampleStatus,
  seedMagSmokeExampleDataset,
} from "@/lib/seed/mag-smoke-example";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireCatalogAdministration() {
  const session = await getServerSession(authOptions);
  return decideServerCapability(session, "system.catalog.manage");
}

export async function GET() {
  const access = await requireCatalogAdministration();
  if (!access.allowed) {
    return authorizationErrorResponse(access);
  }
  return NextResponse.json(await getMagSmokeExampleStatus());
}

export async function POST() {
  const access = await requireCatalogAdministration();
  if (!access.allowed) {
    return authorizationErrorResponse(access);
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
