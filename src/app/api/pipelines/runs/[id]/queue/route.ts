import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  isActiveQueueState,
  isQueueSnapshotRetryable,
  normalizeQueueState,
  queueSnapshotToRunStatus,
  readIdentityCheckedQueueSnapshot,
} from "@/lib/pipelines/queue-probe";
import { canReadPipelineRun } from "@/lib/pipelines/run-visibility";

const TERMINAL_RUN_STATUSES = ["completed", "failed", "cancelled"];

function isTerminalRunStatus(runStatus: string): boolean {
  return TERMINAL_RUN_STATUSES.includes(runStatus);
}

function buildQueueUpdateData(
  runStatus: string,
  queueState: string,
  queueReason: string | null,
  now: Date,
  startedAt?: Date | null
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    queueStatus: queueState || "UNKNOWN",
    queueReason: queueReason || null,
    queueUpdatedAt: now,
  };

  if (isActiveQueueState(queueState)) {
    const nextStatus = queueSnapshotToRunStatus({
      state: queueState,
      reason: queueReason,
      source: null,
      identityVerified: true,
    });
    if (nextStatus !== "queued" && nextStatus !== "running") return data;
    // Only reconcile non-terminal runs. A genuinely terminal run
    // (completed/failed/cancelled) must never be revived from queue
    // liveness: local PIDs and SLURM job IDs are recycled by the OS/
    // scheduler, so a live id no longer identifies the original job.
    const shouldUpdateRunStatus = !isTerminalRunStatus(runStatus);

    if (shouldUpdateRunStatus) {
      data.status = nextStatus;
      data.currentStep =
        nextStatus === "queued" ? "Waiting for scheduler" : "Running on compute node";
      if (nextStatus === "running") {
        data.startedAt = startedAt || now;
      }
      data.statusSource = "queue";
      data.lastEventAt = now;
    }
  }

  return data;
}

async function persistQueueUpdate(
  id: string,
  snapshotStatus: string,
  data: Record<string, unknown>
): Promise<void> {
  if (isTerminalRunStatus(snapshotStatus)) {
    await db.pipelineRun.update({
      where: { id },
      data,
    });
    return;
  }

  // Queue probes await external commands. Guard their stale snapshot against
  // cancellation/finalization claims acquired while ps/squeue/sacct was
  // running, even when the update only refreshes queue metadata.
  await db.pipelineRun.updateMany({
    where: {
      id,
      status: { in: ["pending", "queued", "running"] },
      OR: [
        { statusSource: null },
        {
          statusSource: {
            notIn: ["finalizing", "cancelling"],
          },
        },
      ],
    },
    data,
  });
}

// GET - Check SLURM/local queue status for a pipeline run
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const run = await db.pipelineRun.findUnique({
      where: { id },
      select: {
        id: true,
        queueJobId: true,
        runFolder: true,
        status: true,
        startedAt: true,
        study: { select: { userId: true } },
        order: { select: { userId: true } },
        selectedResultSelections: {
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (!canReadPipelineRun(session.user, run)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!run.queueJobId) {
      return NextResponse.json({
        available: false,
        message: "No queue job id set",
      });
    }

    const jobId = run.queueJobId.trim();
    const snapshot = await readIdentityCheckedQueueSnapshot({
      jobId,
      runId: run.id,
      runFolder: run.runFolder,
    });
    if (isQueueSnapshotRetryable(snapshot)) {
      return NextResponse.json({
        available: false,
        message:
          snapshot.reason ||
          "The exact queue job identity could not be verified",
      });
    }

    const state = normalizeQueueState(snapshot.state) || "UNKNOWN";
    const now = new Date();
    await persistQueueUpdate(
      id,
      run.status,
      buildQueueUpdateData(
        run.status,
        state,
        snapshot.reason,
        now,
        run.startedAt
      )
    );

    if (snapshot.source === "local") {
      return NextResponse.json({
        available: true,
        type: "local",
        status: state.toLowerCase(),
        pid: snapshot.pid,
        exitCode: snapshot.exitCode ?? undefined,
      });
    }

    const details = snapshot.details;
    return NextResponse.json({
      available: true,
      type: "slurm",
      status: state,
      reason: snapshot.reason || undefined,
      elapsed: details?.elapsed,
      exitCode: details?.exitCode,
      source: snapshot.source,
      jobs:
        snapshot.source === "squeue" && details
          ? [
              {
                jobId: details.jobId,
                partition: details.partition || "",
                name: details.name || "",
                user: details.user || "",
                state,
                elapsed: details.elapsed || "",
                nodes: details.nodes || "",
                nodeList: details.nodeList || "",
              },
            ]
          : undefined,
    });
  } catch (error) {
    console.error("[Queue Status API] Error:", error);
    return NextResponse.json(
      { error: "Failed to check queue status" },
      { status: 500 }
    );
  }
}
