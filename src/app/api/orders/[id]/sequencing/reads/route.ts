import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assignOrderSequencingReads } from "@/lib/sequencing/workspace";
import {
  requireFacilityAdminSequencingSession,
  SequencingApiError,
} from "@/lib/sequencing/server";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFacilityAdminSequencingSession();
    const { id } = await params;
    const body = (await request.json()) as {
      assignments?: Array<{
        sampleId: string;
        read1: string | null;
        read2: string | null;
        checksum1?: string | null;
        checksum2?: string | null;
        sequencingRunId?: string | null;
      }>;
    };

    if (!Array.isArray(body.assignments)) {
      return NextResponse.json({ error: "Invalid assignments data" }, { status: 400 });
    }

    const results = await assignOrderSequencingReads(id, body.assignments);
    return NextResponse.json({
      success: results.every((result) => result.success),
      results,
      message: "Sequencing read assignments updated",
    });
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

    console.error("[Order Sequencing] reads PUT error:", error);
    return NextResponse.json(
      { error: "Failed to update sequencing reads" },
      { status: 500 }
    );
  }
}

const CLEARABLE_READ_FIELDS = new Set([
  "checksum1",
  "checksum2",
  "readCount1",
  "readCount2",
  "avgQuality1",
  "avgQuality2",
  "fastqcReport1",
  "fastqcReport2",
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFacilityAdminSequencingSession();
    const { id: orderId } = await params;
    const body = (await request.json()) as {
      sampleId: string;
      clearFields: string[];
    };

    if (!body.sampleId || !Array.isArray(body.clearFields) || body.clearFields.length === 0) {
      return NextResponse.json({ error: "Missing sampleId or clearFields" }, { status: 400 });
    }

    const invalidFields = body.clearFields.filter((f) => !CLEARABLE_READ_FIELDS.has(f));
    if (invalidFields.length > 0) {
      return NextResponse.json(
        { error: `Invalid fields: ${invalidFields.join(", ")}` },
        { status: 400 }
      );
    }

    const read = await db.read.findFirst({
      where: { sample: { id: body.sampleId, orderId } },
      select: { id: true },
    });

    if (!read) {
      return NextResponse.json({ error: "Read record not found" }, { status: 404 });
    }

    const updateData: Record<string, null> = {};
    for (const field of body.clearFields) {
      updateData[field] = null;
    }

    await db.read.update({
      where: { id: read.id },
      data: updateData,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Order Sequencing] reads PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to clear read fields" },
      { status: 500 }
    );
  }
}
