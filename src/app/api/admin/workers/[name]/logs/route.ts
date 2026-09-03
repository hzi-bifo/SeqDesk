import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";
import { db } from "@/lib/db";
import { tailLog } from "@/lib/workers/process";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const session = await getServerSession(authOptions);
  const access = decideServerCapability(session, "system.pipelines.manage");
  if (!access.allowed) {
    return authorizationErrorResponse(access);
  }
  const { name } = await params;
  const tailParam = Number(request.nextUrl.searchParams.get("tail") ?? 200);
  const tail = Math.max(1, Math.min(2000, Number.isFinite(tailParam) ? tailParam : 200));

  const row = await db.backgroundWorkerProcess.findFirst({
    where: { name },
    orderBy: { startedAt: "desc" },
    select: { logPath: true, pid: true, startedAt: true, status: true },
  });
  if (!row) {
    return NextResponse.json({ lines: [], message: `No worker process recorded for ${name}` });
  }
  const lines = await tailLog(row.logPath, tail);
  return NextResponse.json({
    lines,
    pid: row.pid,
    startedAt: row.startedAt.toISOString(),
    status: row.status,
    logPath: row.logPath,
  });
}
