import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";
import { db } from "@/lib/db";
import { stopWorker } from "@/lib/workers/process";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const session = await getServerSession(authOptions);
  const access = decideServerCapability(session, "system.pipelines.manage");
  if (!access.allowed) {
    return authorizationErrorResponse(access);
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
