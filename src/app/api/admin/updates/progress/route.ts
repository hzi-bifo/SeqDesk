import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentVersion, getInstalledVersion } from "@/lib/updater";
import { clearUpdateStatus, readUpdateStatus, writeUpdateStatus } from "@/lib/updater/status";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await readUpdateStatus();
  const runningVersion = getCurrentVersion();
  const installedVersion = await getInstalledVersion();

  if (
    status &&
    status.targetVersion &&
    installedVersion === status.targetVersion &&
    runningVersion === status.targetVersion &&
    status.status !== "error" &&
    status.status !== "complete"
  ) {
    const nextStatus = {
      ...status,
      status: "complete" as const,
      progress: 100,
      message: "Update complete.",
    };
    await writeUpdateStatus(nextStatus, { targetVersion: status.targetVersion });
    return NextResponse.json({
      status: nextStatus,
      runningVersion,
      installedVersion,
    });
  }

  if (
    status &&
    status.status === "complete" &&
    status.targetVersion &&
    runningVersion === status.targetVersion &&
    installedVersion === status.targetVersion
  ) {
    await clearUpdateStatus();
    return NextResponse.json({
      status: null,
      runningVersion,
      installedVersion,
    });
  }

  return NextResponse.json({
    status,
    runningVersion,
    installedVersion,
  });
}
