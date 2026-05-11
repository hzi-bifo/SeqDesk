import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  DEFAULT_MINKNOW_CONFIG,
  loadMinknowConfig,
  saveMinknowConfig,
  type MinknowStreamConfig,
} from "@/lib/minknow/config";

function sanitize(input: unknown): MinknowStreamConfig {
  const partial = (input ?? {}) as Partial<MinknowStreamConfig>;
  const port = Number(partial.grpcPort ?? DEFAULT_MINKNOW_CONFIG.grpcPort);
  const interval = Number(partial.pollIntervalMs ?? DEFAULT_MINKNOW_CONFIG.pollIntervalMs);
  const stability = Number(partial.stabilityThresholdMs ?? DEFAULT_MINKNOW_CONFIG.stabilityThresholdMs);
  return {
    enabled: Boolean(partial.enabled ?? false),
    host: typeof partial.host === "string" && partial.host.trim().length > 0
      ? partial.host.trim()
      : DEFAULT_MINKNOW_CONFIG.host,
    grpcPort: Number.isFinite(port) && port > 0 && port < 65536 ? port : DEFAULT_MINKNOW_CONFIG.grpcPort,
    tlsCaCertPath: typeof partial.tlsCaCertPath === "string" ? partial.tlsCaCertPath.trim() : "",
    outputRoot: typeof partial.outputRoot === "string" ? partial.outputRoot.trim() : "",
    pollIntervalMs: Number.isFinite(interval) && interval >= 1000 ? interval : DEFAULT_MINKNOW_CONFIG.pollIntervalMs,
    usePolling: Boolean(partial.usePolling ?? DEFAULT_MINKNOW_CONFIG.usePolling),
    stabilityThresholdMs:
      Number.isFinite(stability) && stability >= 500
        ? stability
        : DEFAULT_MINKNOW_CONFIG.stabilityThresholdMs,
  };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const config = await loadMinknowConfig();
    return NextResponse.json({ config });
  } catch (error) {
    console.error("[minknow settings] load failed", error);
    return NextResponse.json({ config: DEFAULT_MINKNOW_CONFIG });
  }
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const next = sanitize(body?.config);
    await saveMinknowConfig(next);
    return NextResponse.json({ success: true, config: next });
  } catch (error) {
    console.error("[minknow settings] save failed", error);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
