import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTelemetrySettings, saveTelemetrySettings } from "@/lib/telemetry";

async function requireFacilityAdmin() {
  const session = await getServerSession(authOptions);
  return session?.user?.role === "FACILITY_ADMIN";
}

export async function GET() {
  if (!(await requireFacilityAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await getTelemetrySettings());
  } catch {
    return NextResponse.json(
      { error: "Failed to load telemetry settings" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  if (!(await requireFacilityAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    return NextResponse.json(await saveTelemetrySettings(body));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save telemetry settings";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
