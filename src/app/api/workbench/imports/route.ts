import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { ZodError } from "zod";
import { authOptions } from "@/lib/auth";
import { getWorkbenchImporter } from "@/lib/workbench/importers/registry";
import { createWorkbenchImportJob, runWorkbenchImportJob } from "@/lib/workbench/import-jobs";
import { resolveWorkbenchStorageBase } from "@/lib/workbench/storage";
import { listWorkbenchImportJobs } from "@/lib/workbench/workspaces";
import { authorizeWorkbenchRequest } from "@/lib/workbench/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  const access = authorizeWorkbenchRequest(session);
  if (!access.allowed) return access.response;

  return NextResponse.json({ jobs: await listWorkbenchImportJobs(access.userId) });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = authorizeWorkbenchRequest(session, "workbench.import");
  if (!access.allowed) return access.response;

  try {
    const body = await request.json();
    const providerId = typeof body?.providerId === "string" ? body.providerId : "";
    const provider = getWorkbenchImporter(providerId);
    if (!provider) {
      return NextResponse.json({ error: "Workbench importer not found" }, { status: 404 });
    }

    const preflight = await provider.preflight();
    if (!preflight.ok) {
      return NextResponse.json(
        { error: preflight.message, details: preflight.details },
        { status: 400 }
      );
    }

    try {
      await resolveWorkbenchStorageBase();
    } catch (storageError) {
      return NextResponse.json(
        {
          error:
            storageError instanceof Error
              ? storageError.message
              : "Workbench storage is not configured",
        },
        { status: 400 }
      );
    }

    const input = provider.inputSchema.parse(body.input ?? {});
    const preview = await provider.preview(input);
    if (preview.summary.selectedCount === 0) {
      return NextResponse.json(
        { error: "Preview did not return any data to import." },
        { status: 400 }
      );
    }

    const { job } = await createWorkbenchImportJob({
      userId: access.userId,
      providerId,
      input,
      preview,
    });
    void runWorkbenchImportJob(job.id);

    return NextResponse.json({ success: true, started: true, job }, { status: 202 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid importer input", issues: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start Workbench import" },
      { status: 500 }
    );
  }
}
