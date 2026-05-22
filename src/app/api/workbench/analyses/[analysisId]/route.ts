import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { ZodError } from "zod";
import { authOptions } from "@/lib/auth";
import {
  getWorkbenchAnalysisForUser,
  updateWorkbenchAnalysis,
} from "@/lib/workbench/analyses";
import { workbenchCanvasSchema } from "@/lib/workbench/canvas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ analysisId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { analysisId } = await params;
  const analysis = await getWorkbenchAnalysisForUser(session.user.id, analysisId);
  if (!analysis) {
    return NextResponse.json({ error: "Workbench analysis not found" }, { status: 404 });
  }
  return NextResponse.json({ analysis });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ analysisId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { analysisId } = await params;
    const body = await request.json();
    const revision = Number(body?.revision);
    if (!Number.isInteger(revision) || revision < 1) {
      return NextResponse.json({ error: "Current analysis revision is required" }, { status: 400 });
    }

    const result = await updateWorkbenchAnalysis({
      userId: session.user.id,
      analysisId,
      revision,
      name: typeof body?.name === "string" ? body.name : undefined,
      description:
        typeof body?.description === "string" || body?.description === null
          ? body.description
          : undefined,
      canvas: body?.canvas ? workbenchCanvasSchema.parse(body.canvas) : undefined,
    });

    if (!result.analysis) {
      return NextResponse.json({ error: "Workbench analysis not found" }, { status: 404 });
    }
    if (result.conflict) {
      return NextResponse.json(
        { error: "Workbench analysis changed on the server", analysis: result.analysis },
        { status: 409 }
      );
    }

    return NextResponse.json({ analysis: result.analysis });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid Workbench canvas", issues: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update Workbench analysis" },
      { status: 500 }
    );
  }
}
