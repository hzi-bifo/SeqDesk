import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentVersion, getInstalledVersion } from "@/lib/updater";
import { loadInstalledDatabaseConfig } from "@/lib/updater/database-config";
import { checkForUpdatesInternal } from "@/lib/updater/checker";
import { sendTelemetryHeartbeat } from "@/lib/telemetry";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const updateResult = await checkForUpdatesInternal(true, { telemetry: false });
    const runningVersion = getCurrentVersion();
    const installedVersion = await getInstalledVersion();
    const databaseConfig = await loadInstalledDatabaseConfig();
    const result = await sendTelemetryHeartbeat(
      {
        runningVersion,
        installedVersion,
        updateAvailable: updateResult.updateAvailable,
        latestVersion: updateResult.latest?.version ?? null,
        databaseProvider: databaseConfig.provider,
      },
      { force: true }
    );

    if (!result.sent) {
      return NextResponse.json(
        {
          success: false,
          reason: result.reason,
          error: result.error,
          lastSentAt: result.lastSentAt ?? null,
        },
        { status: result.reason === "disabled" ? 400 : 502 }
      );
    }

    return NextResponse.json({
      success: true,
      status: result.status,
      lastSentAt: result.lastSentAt ?? null,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to send telemetry heartbeat" },
      { status: 500 }
    );
  }
}
