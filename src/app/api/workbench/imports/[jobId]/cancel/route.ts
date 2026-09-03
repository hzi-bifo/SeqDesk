import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOrCreateDefaultWorkbenchWorkspace, serializeWorkbenchImportJob } from "@/lib/workbench/workspaces";
import { authorizeWorkbenchRequest } from "@/lib/workbench/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await getServerSession(authOptions);
  const access = authorizeWorkbenchRequest(session, "workbench.import");
  if (!access.allowed) return access.response;

  const workspace = await getOrCreateDefaultWorkbenchWorkspace(access.userId);
  const { jobId } = await params;
  const job = await db.workbenchImportJob.findFirst({
    where: { id: jobId, workspaceId: workspace.id },
  });
  if (!job) {
    return NextResponse.json({ error: "Import job not found" }, { status: 404 });
  }
  if (job.status !== "queued") {
    return NextResponse.json(
      { error: "Only queued Workbench imports can be cancelled in this version." },
      { status: 409 }
    );
  }

  const cancelled = await db.workbenchImportJob.update({
    where: { id: job.id },
    data: {
      status: "cancelled",
      phase: "cancelled",
      progress: 0,
      finishedAt: new Date(),
    },
  });

  return NextResponse.json({ success: true, job: serializeWorkbenchImportJob(cancelled) });
}
