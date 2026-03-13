import { NextResponse } from "next/server";
import { createSequencingUploadSession } from "@/lib/sequencing/workspace";
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
      targetKind?: string;
      targetRole?: string;
      originalName?: string;
      expectedSize?: number;
      checksumProvided?: string | null;
      mimeType?: string | null;
      metadata?: {
        stage?: string;
        artifactType?: string;
        visibility?: string;
        sequencingRunId?: string | null;
        source?: string;
      } | null;
    };

    if (!body.targetKind || !body.targetRole || !body.originalName || !body.expectedSize) {
      return NextResponse.json(
        { error: "targetKind, targetRole, originalName, and expectedSize are required" },
        { status: 400 }
      );
    }

    const upload = await createSequencingUploadSession(id, session.user.id, {
      sampleId: body.sampleId,
      targetKind: body.targetKind,
      targetRole: body.targetRole,
      originalName: body.originalName,
      expectedSize: body.expectedSize,
      checksumProvided: body.checksumProvided ?? null,
      mimeType: body.mimeType ?? null,
      metadata: body.metadata ?? null,
    });

    return NextResponse.json({ success: true, ...upload });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error && error.message === "Order not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    if (error instanceof Error && /configured|submitted or completed/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("[Order Sequencing] upload POST error:", error);
    return NextResponse.json(
      { error: "Failed to create upload session" },
      { status: 500 }
    );
  }
}
