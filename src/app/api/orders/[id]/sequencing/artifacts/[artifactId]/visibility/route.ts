import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  CUSTOMER_SEQUENCING_ARTIFACT_VISIBILITY,
  FACILITY_SEQUENCING_ARTIFACT_VISIBILITY,
} from "@/lib/sequencing/delivery";
import {
  requireFacilityAdminSequencingSession,
  SequencingApiError,
} from "@/lib/sequencing/server";

const ALLOWED_VISIBILITIES = new Set([
  CUSTOMER_SEQUENCING_ARTIFACT_VISIBILITY,
  FACILITY_SEQUENCING_ARTIFACT_VISIBILITY,
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  try {
    await requireFacilityAdminSequencingSession();
    const { id, artifactId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      visibility?: string;
    };
    const visibility = body.visibility;

    if (!visibility || !ALLOWED_VISIBILITIES.has(visibility)) {
      return NextResponse.json(
        { error: "visibility must be customer or facility" },
        { status: 400 }
      );
    }

    const existing = await db.sequencingArtifact.findFirst({
      where: { id: artifactId, orderId: id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }

    const artifact = await db.sequencingArtifact.update({
      where: { id: artifactId },
      data: { visibility },
      select: {
        id: true,
        orderId: true,
        sampleId: true,
        sequencingRunId: true,
        stage: true,
        artifactType: true,
        source: true,
        visibility: true,
        path: true,
        originalName: true,
        size: true,
        checksum: true,
        mimeType: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      artifact: {
        ...artifact,
        size: artifact.size === null ? null : Number(artifact.size),
        createdAt: artifact.createdAt.toISOString(),
        updatedAt: artifact.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[Order Sequencing] artifact visibility PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update artifact visibility" },
      { status: 500 }
    );
  }
}
