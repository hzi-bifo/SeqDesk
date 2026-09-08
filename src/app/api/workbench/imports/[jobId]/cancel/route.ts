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
  if (job.status !== "queued" && job.status !== "running") {
    return NextResponse.json(
      { error: "This import has already finished. Refresh to see its result." },
      { status: 409 }
    );
  }

  const changed = await db.workbenchImportJob.updateMany({
    where: { id: job.id, workspaceId: workspace.id, status: job.status },
    data: job.status === "running" ? { phase: "cancelling" } : {
      status: "cancelled",
      phase: "cancelled",
      progress: 0,
      finishedAt: new Date(),
    },
  });

  if (changed.count !== 1) {
    return NextResponse.json(
      { error: "Import state changed; refresh before trying again." },
      { status: 409 }
    );
  }
  const cancelled = await db.workbenchImportJob.findFirst({
    where: { id: job.id, workspaceId: workspace.id },
  });
  if (!cancelled) {
    return NextResponse.json({ error: "Import job not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, job: serializeWorkbenchImportJob(cancelled) });
}
