import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";
import { getTelemetrySettings, saveTelemetrySettings } from "@/lib/telemetry";

async function requireSettingsManager() {
  const session = await getServerSession(authOptions);
  return decideServerCapability(session, "system.settings.manage");
}

export async function GET() {
  const access = await requireSettingsManager();
  if (!access.allowed) {
    return authorizationErrorResponse(access);
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
  const access = await requireSettingsManager();
  if (!access.allowed) {
    return authorizationErrorResponse(access);
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
