import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { stopWorker } from "@/lib/workers/process";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name } = await params;
  const row = await db.backgroundWorkerProcess.findFirst({
    where: { name, status: { in: ["RUNNING", "STOPPING", "ZOMBIE"] } },
    orderBy: { startedAt: "desc" },
  });

  if (!row) {
    return NextResponse.json({ error: `No running ${name} to stop` }, { status: 404 });
  }

  if (row.status === "ZOMBIE") {
    // Just clear the zombie row; nothing to kill.
    await db.backgroundWorkerProcess.update({
      where: { id: row.id },
      data: { status: "STOPPED", stoppedAt: row.stoppedAt ?? new Date() },
    });
    return NextResponse.json({ ok: true, cleared: "zombie" });
  }

  const result = await stopWorker(row.id);
  return NextResponse.json({ ok: result.stopped });
}
