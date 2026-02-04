import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function parseFirstLine(value: string): string {
  const line = value.split("\n").map((l) => l.trim()).filter(Boolean)[0];
  return line || "";
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
        study: { select: { userId: true } },
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (
      session.user.role !== "FACILITY_ADMIN" &&
      run.study?.userId !== session.user.id
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
        await db.pipelineRun.update({
          where: { id },
          data: {
            queueStatus: "RUNNING",
            queueUpdatedAt: new Date(),
          },
        });
        return NextResponse.json({
          available: true,
          type: "local",
          status: "running",
          pid,
        });
      } catch {
        await db.pipelineRun.update({
          where: { id },
          data: {
            queueStatus: "EXITED",
            queueUpdatedAt: new Date(),
          },
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
        ["-j", jobId, "-h", "-o", "%T|%R|%M"],
        { timeout: 5000 }
      );
      const line = parseFirstLine(stdout);
      if (line) {
        const [state, reason, elapsed] = line.split("|");
        await db.pipelineRun.update({
          where: { id },
          data: {
            queueStatus: state || "UNKNOWN",
            queueReason: reason || null,
            queueUpdatedAt: new Date(),
          },
        });
        return NextResponse.json({
          available: true,
          type: "slurm",
          status: state || "unknown",
          reason: reason || undefined,
          elapsed: elapsed || undefined,
          source: "squeue",
        });
      }
    } catch {
      // Ignore and try sacct
    }

    try {
      const { stdout } = await execFileAsync(
        "sacct",
        ["-j", jobId, "--format=State,Elapsed,ExitCode", "--noheader"],
        { timeout: 5000 }
      );
      const line = parseFirstLine(stdout);
      if (line) {
        const [state, elapsed, exitCode] = line.split(/\s+/);
        await db.pipelineRun.update({
          where: { id },
          data: {
            queueStatus: state || "UNKNOWN",
            queueReason: null,
            queueUpdatedAt: new Date(),
          },
        });
        return NextResponse.json({
          available: true,
          type: "slurm",
          status: state || "unknown",
          elapsed: elapsed || undefined,
          exitCode: exitCode || undefined,
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
