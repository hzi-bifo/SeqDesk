import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";
import { getCurrentVersion, getInstalledVersion } from "@/lib/updater";
import { loadInstalledDatabaseConfig } from "@/lib/updater/database-config";
import { checkForUpdatesInternal } from "@/lib/updater/checker";
import { sendTelemetryHeartbeat } from "@/lib/telemetry";

export async function POST() {
  const session = await getServerSession(authOptions);
  const access = decideServerCapability(session, "system.settings.manage");
  if (!access.allowed) {
    return authorizationErrorResponse(access);
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
