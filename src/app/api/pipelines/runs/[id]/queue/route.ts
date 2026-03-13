import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

type SlurmJobRow = {
  jobId: string;
  partition: string;
  name: string;
  user: string;
  state: string;
  elapsed: string;
  nodes: string;
  nodeList: string;
};

function parseSqueueRows(value: string): SlurmJobRow[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [jobId, partition, name, user, state, elapsed, nodes, nodeList] = line.split("|");
      return {
        jobId: (jobId || "").trim(),
        partition: (partition || "").trim(),
        name: (name || "").trim(),
        user: (user || "").trim(),
        state: (state || "").trim(),
        elapsed: (elapsed || "").trim(),
        nodes: (nodes || "").trim(),
        nodeList: (nodeList || "").trim(),
      };
    })
    .filter((row) => row.jobId.length > 0);
}

function normalizeQueueState(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return normalized || null;
}

function isQueueStateLikelyActive(value: string | null | undefined): boolean {
  const normalized = normalizeQueueState(value);
  if (!normalized || normalized === "UNKNOWN") return false;

  if (
    normalized === "COMPLETED" ||
    normalized === "EXITED" ||
    normalized === "REVOKED" ||
    normalized === "TIMEOUT" ||
    normalized === "OUT_OF_MEMORY" ||
    normalized === "NODE_FAIL" ||
    normalized === "BOOT_FAIL" ||
    normalized === "PREEMPTED" ||
    normalized === "DEADLINE"
  ) {
    return false;
  }

  return !normalized.startsWith("CANCELLED")
    && !normalized.startsWith("CANCELED")
    && !normalized.startsWith("FAILED");
}

function queueStateToRunStatus(value: string | null | undefined): "queued" | "running" {
  const normalized = normalizeQueueState(value);
  if (normalized === "PENDING" || normalized === "CONFIGURING") {
    return "queued";
  }
  return "running";
}

function shouldReviveRun(runStatus: string): boolean {
  return ["completed", "failed", "cancelled"].includes(runStatus);
}

function buildQueueUpdateData(
  runStatus: string,
  queueState: string,
  queueReason: string | null,
  now: Date
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    queueStatus: queueState || "UNKNOWN",
    queueReason: queueReason || null,
    queueUpdatedAt: now,
  };

  if (isQueueStateLikelyActive(queueState) && shouldReviveRun(runStatus)) {
    const revivedStatus = queueStateToRunStatus(queueState);
    data.status = revivedStatus;
    data.currentStep = revivedStatus === "queued" ? "Queued" : "Finalizing...";
    data.completedAt = null;
    data.statusSource = "queue";
    data.lastEventAt = now;
  }

  return data;
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
        status: true,
        study: { select: { userId: true } },
        order: { select: { userId: true } },
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (
      session.user.role !== "FACILITY_ADMIN" &&
      run.study?.userId !== session.user.id &&
      run.order?.userId !== session.user.id
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!run.queueJobId) {
      return NextResponse.json({
        available: false,
        message: "No queue job id set",
      });
    }

    const jobId = run.queueJobId.trim();

    if (jobId.startsWith("local-")) {
      const pid = Number(jobId.replace("local-", ""));
      if (!Number.isInteger(pid) || pid <= 0) {
        return NextResponse.json({
          available: false,
          message: "Invalid local job id",
        });
      }

      try {
        await execFileAsync("ps", ["-p", String(pid), "-o", "pid="], {
          timeout: 5000,
        });
        const now = new Date();
        await db.pipelineRun.update({
          where: { id },
          data: buildQueueUpdateData(run.status, "RUNNING", null, now),
        });
        return NextResponse.json({
          available: true,
          type: "local",
          status: "running",
          pid,
        });
      } catch {
        const now = new Date();
        await db.pipelineRun.update({
          where: { id },
          data: buildQueueUpdateData(run.status, "EXITED", null, now),
        });
        return NextResponse.json({
          available: true,
          type: "local",
          status: "exited",
          pid,
        });
      }
    }

    if (!/^\d+$/.test(jobId)) {
      return NextResponse.json({
        available: false,
        message: "Unknown job id format",
      });
    }

    try {
      const { stdout } = await execFileAsync(
        "squeue",
        ["-j", jobId, "-h", "-o", "%i|%P|%j|%u|%T|%M|%D|%R"],
        { timeout: 5000 }
      );
      const jobs = parseSqueueRows(stdout);
      if (jobs.length > 0) {
        const primary = jobs[0];
        const state = primary.state || "UNKNOWN";
        const reason = primary.nodeList || null;
        const elapsed = primary.elapsed || undefined;
        const now = new Date();
        await db.pipelineRun.update({
          where: { id },
          data: buildQueueUpdateData(run.status, state, reason, now),
        });
        return NextResponse.json({
          available: true,
          type: "slurm",
          status: state || "unknown",
          reason: reason || undefined,
          elapsed,
          source: "squeue",
          jobs,
        });
      }
    } catch {
      // Ignore and try sacct
    }

    try {
      const { stdout } = await execFileAsync(
        "sacct",
        ["-X", "-P", "-j", jobId, "--format=JobID,State,Elapsed,ExitCode", "--noheader"],
        { timeout: 5000 }
      );
      const rows = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [rowJobId, rowState, rowElapsed, rowExitCode] = line.split("|");
          return {
            jobId: (rowJobId || "").trim(),
            state: (rowState || "").trim(),
            elapsed: (rowElapsed || "").trim(),
            exitCode: (rowExitCode || "").trim(),
          };
        });

      const primary =
        rows.find((row) => row.jobId === jobId) ||
        rows.find((row) => row.jobId.startsWith(`${jobId}.`)) ||
        rows[0];

      if (primary) {
        const now = new Date();
        await db.pipelineRun.update({
          where: { id },
          data: buildQueueUpdateData(run.status, primary.state || "UNKNOWN", null, now),
        });
        return NextResponse.json({
          available: true,
          type: "slurm",
          status: primary.state || "unknown",
          elapsed: primary.elapsed || undefined,
          exitCode: primary.exitCode || undefined,
          source: "sacct",
        });
      }
    } catch {
      // Ignore and fall through
    }

    return NextResponse.json({
      available: false,
      message: "Job not found in squeue or sacct",
    });
  } catch (error) {
    console.error("[Queue Status API] Error:", error);
    return NextResponse.json(
      { error: "Failed to check queue status" },
      { status: 500 }
    );
  }
}
