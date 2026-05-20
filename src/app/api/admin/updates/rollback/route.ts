import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { rollbackInstalledUpdate } from "@/lib/updater/installer";
import { notifyAppUpdateProgressInApp } from "@/lib/notifications/in-app";
import {
  acquireUpdateLock,
  isUpdateInProgress,
  readUpdateState,
  releaseUpdateLock,
  writeUpdateStatus,
} from "@/lib/updater/status";

/**
 * POST /api/admin/updates/rollback
 *
 * Switch the current release symlink back to the previous release recorded by
 * the staged updater, then restart the application.
 */
export async function POST() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    if (await isUpdateInProgress()) {
      return NextResponse.json(
        { error: "Update already in progress" },
        { status: 409 }
      );
    }

    const lockAcquired = await acquireUpdateLock();
    if (!lockAcquired) {
      return NextResponse.json(
        { error: "Update already in progress" },
        { status: 409 }
      );
    }

    const state = await readUpdateState();
    if (!state?.previousRelease) {
      await releaseUpdateLock();
      return NextResponse.json(
        { error: "No previous release is recorded for rollback" },
        { status: 409 }
      );
    }

    const targetVersion = state.targetVersion || undefined;
    await writeUpdateStatus(
      { status: "checking", progress: 0, message: "Preparing release rollback..." },
      { targetVersion }
    );

    rollbackInstalledUpdate((progress) => {
      console.log(`Update rollback progress: ${progress.status} - ${progress.message}`);
      void writeUpdateStatus(progress, { targetVersion })
        .then(() => notifyAppUpdateProgressInApp(progress, { targetVersion }))
        .catch((error) => console.error("Failed to write update rollback status:", error));
    }).catch((error) => {
      console.error("Update rollback failed:", error);
    });

    return NextResponse.json({
      success: true,
      rollback: true,
      message: "Rolling back to the previous release. SeqDesk will attempt automatic restart.",
    });
  } catch (error) {
    console.error("Update rollback failed:", error);
    await releaseUpdateLock();
    return NextResponse.json(
      { error: "Failed to start rollback" },
      { status: 500 }
    );
  }
}
