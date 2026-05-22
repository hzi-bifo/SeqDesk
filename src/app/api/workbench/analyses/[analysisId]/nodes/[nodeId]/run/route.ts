import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { ZodError } from "zod";
import { authOptions } from "@/lib/auth";
import { getWorkbenchAnalysisForUser } from "@/lib/workbench/analyses";
import { createWorkbenchImportJob, runWorkbenchImportJob } from "@/lib/workbench/import-jobs";
import { getWorkbenchImporter } from "@/lib/workbench/importers/registry";
import { resolveWorkbenchStorageBase } from "@/lib/workbench/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ analysisId: string; nodeId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { analysisId, nodeId } = await params;
    const analysis = await getWorkbenchAnalysisForUser(session.user.id, analysisId);
    if (!analysis) {
      return NextResponse.json({ error: "Workbench analysis not found" }, { status: 404 });
    }

    const node = analysis.canvas.nodes.find((entry) => entry.id === nodeId);
    if (!node) {
      return NextResponse.json({ error: "Workbench canvas node not found" }, { status: 404 });
    }
    if (node.data.kind !== "source.importer" || !node.data.providerId) {
      return NextResponse.json(
        { error: "Only source importer nodes can be run in this version." },
        { status: 400 }
      );
    }

    const provider = getWorkbenchImporter(node.data.providerId);
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

    const input = provider.inputSchema.parse(node.data.config ?? {});
    const preview = await provider.preview(input);
    if (preview.genomes.length === 0) {
      return NextResponse.json(
        { error: "Preview did not return any genomes to import." },
        { status: 400 }
      );
    }

    const { job } = await createWorkbenchImportJob({
      userId: session.user.id,
      providerId: provider.id,
      input,
      preview,
      analysisId,
      analysisNodeId: nodeId,
    });
    void runWorkbenchImportJob(job.id);

    return NextResponse.json({ success: true, started: true, job }, { status: 202 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid source block configuration", issues: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run Workbench canvas node" },
      { status: 500 }
    );
  }
}
