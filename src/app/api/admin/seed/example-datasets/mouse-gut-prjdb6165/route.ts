import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  getMouseGutExampleStatus,
  seedMouseGutExampleDataset,
} from "@/lib/seed/mouse-gut-ena-example";

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
  return NextResponse.json(await getMouseGutExampleStatus());
}

export async function POST() {
  if (!(await requireFacilityAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await seedMouseGutExampleDataset();
    const status = await getMouseGutExampleStatus();
    return NextResponse.json({ success: true, result, status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to seed the mouse-gut PRJDB6165 example dataset";
    console.error("[mouse-gut example seed] Failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
