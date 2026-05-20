import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { notifyAppUpdateProgressInApp } from "@/lib/notifications/in-app";
import { getCurrentVersion, getInstalledVersion } from "@/lib/updater";
import {
  clearUpdateStatus,
  readUpdateState,
  readUpdateStatus,
  releaseUpdateLock,
  writeUpdateStatus,
} from "@/lib/updater/status";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await readUpdateStatus();
  const state = await readUpdateState();
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
    await notifyAppUpdateProgressInApp(nextStatus, {
      targetVersion: status.targetVersion,
    });
    return NextResponse.json({
      status: nextStatus,
      state,
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
      state,
      runningVersion,
      installedVersion,
    });
  }

  return NextResponse.json({
    status,
    state,
    runningVersion,
    installedVersion,
  });
}

export async function DELETE() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await readUpdateStatus();
  if (status && !["idle", "complete", "error"].includes(status.status)) {
    return NextResponse.json(
      { error: "Cannot clear update status while an update is in progress" },
      { status: 409 }
    );
  }

  await clearUpdateStatus();
  await releaseUpdateLock();

  return NextResponse.json({ success: true });
}
