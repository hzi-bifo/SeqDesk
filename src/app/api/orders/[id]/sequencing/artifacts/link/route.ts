import { NextResponse } from "next/server";
import { linkOrderSequencingArtifact } from "@/lib/sequencing/workspace";
import {
  requireFacilityAdminSequencingSession,
  SequencingApiError,
} from "@/lib/sequencing/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireFacilityAdminSequencingSession();
    const { id } = await params;
    const body = (await request.json()) as {
      sampleId?: string | null;
      sequencingRunId?: string | null;
      stage?: string;
      artifactType?: string;
      path?: string;
      originalName?: string | null;
      checksum?: string | null;
      mimeType?: string | null;
      metadata?: string | null;
      visibility?: string | null;
      source?: string | null;
    };

    if (!body.stage || !body.artifactType || !body.path) {
      return NextResponse.json(
        { error: "stage, artifactType, and path are required" },
        { status: 400 }
      );
    }

    const artifact = await linkOrderSequencingArtifact(id, {
      sampleId: body.sampleId ?? null,
      sequencingRunId: body.sequencingRunId ?? null,
      stage: body.stage,
      artifactType: body.artifactType,
      path: body.path,
      originalName: body.originalName ?? null,
      checksum: body.checksum ?? null,
      mimeType: body.mimeType ?? null,
      metadata: body.metadata ?? null,
      visibility: body.visibility ?? null,
      source: body.source ?? null,
      createdById: session.user.id,
    });

    return NextResponse.json({ success: true, artifact });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error && error.message === "Order not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    if (error instanceof Error && /configured|required|submitted or completed/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("[Order Sequencing] artifact link POST error:", error);
    return NextResponse.json(
      { error: "Failed to link sequencing artifact" },
      { status: 500 }
    );
  }
}
