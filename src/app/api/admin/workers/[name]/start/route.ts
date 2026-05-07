import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWorkerSpec } from "@/lib/workers/registry";
import { isProcessAlive, startWorker } from "@/lib/workers/process";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name } = await params;
  const spec = getWorkerSpec(name);
  if (!spec) {
    return NextResponse.json({ error: `Unknown worker: ${name}` }, { status: 404 });
  }
  if (spec.devOnly && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: `${name} is dev-only and cannot be started in production` }, { status: 403 });
  }

  // Single-instance guard: refuse to start if a row is RUNNING/STOPPING and the PID
  // is actually alive. Reconcile dead-but-RUNNING rows to ZOMBIE first.
  const existing = await db.backgroundWorkerProcess.findFirst({
    where: { name, status: { in: ["RUNNING", "STOPPING"] } },
    orderBy: { startedAt: "desc" },
  });
  if (existing && isProcessAlive(existing.pid)) {
    return NextResponse.json(
      { error: `${name} is already running (pid=${existing.pid}). Stop it first.` },
      { status: 409 },
    );
  }
  if (existing && !isProcessAlive(existing.pid)) {
    await db.backgroundWorkerProcess.update({
      where: { id: existing.id },
      data: { status: "ZOMBIE", stoppedAt: existing.stoppedAt ?? new Date() },
    });
  }

  try {
    const row = await startWorker(spec, { startedById: session.user.id });
    return NextResponse.json({ ok: true, id: row.id, pid: row.pid, logPath: row.logPath }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[workers/start] ${name} failed:`, error);
    return NextResponse.json({ error: `Failed to start ${name}: ${message}` }, { status: 500 });
  }
}
