import { NextResponse } from "next/server";
import { checkFileExists } from "@/lib/files";
import { getSequencingFilesConfig } from "@/lib/files/sequencing-config";
import { getOrderSequencingSummary, assignOrderSequencingReads } from "@/lib/sequencing/workspace";
import {
  requireFacilityAdminSequencingSession,
  SequencingApiError,
} from "@/lib/sequencing/server";

interface LegacySampleFileInfo {
  sampleId: string;
  sampleAlias: string | null;
  sampleTitle: string | null;
  read1: string | null;
  read2: string | null;
  read1Exists: boolean;
  read2Exists: boolean;
  suggestedRead1: string | null;
  suggestedRead2: string | null;
  suggestionStatus: "exact" | "partial" | "ambiguous" | "none" | "assigned";
  suggestionConfidence: number;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFacilityAdminSequencingSession();
    const { id } = await params;
    const [summary, configResult] = await Promise.all([
      getOrderSequencingSummary(id),
      getSequencingFilesConfig(),
    ]);

    const samples: LegacySampleFileInfo[] = await Promise.all(
      summary.samples.map(async (sample) => {
        const read1 = sample.read?.file1 ?? null;
        const read2 = sample.read?.file2 ?? null;
        const read1Exists =
          Boolean(configResult.dataBasePath && read1) &&
          Boolean(await checkFileExists(configResult.dataBasePath as string, read1 as string));
        const read2Exists =
          Boolean(configResult.dataBasePath && read2) &&
          Boolean(await checkFileExists(configResult.dataBasePath as string, read2 as string));

        return {
          sampleId: sample.sampleId,
          sampleAlias: sample.sampleAlias,
          sampleTitle: sample.sampleTitle,
          read1,
          read2,
          read1Exists,
          read2Exists,
          suggestedRead1: null,
          suggestedRead2: null,
          suggestionStatus: read1 || read2 ? "assigned" : "none",
          suggestionConfidence: read1 || read2 ? 1 : 0,
        };
      })
    );

    return NextResponse.json({
      orderId: summary.orderId,
      orderName: summary.orderName,
      orderStatus: summary.orderStatus,
      canAssign: summary.canManage,
      dataBasePath: configResult.dataBasePath,
      config: {
        allowedExtensions: configResult.config.allowedExtensions,
        allowSingleEnd: configResult.config.allowSingleEnd,
      },
      samples,
    });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error && error.message === "Order not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error("[Order Files Legacy] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch order files" },
      { status: 500 }
    );
  }
}

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
      }>;
    };

    if (!Array.isArray(body.assignments)) {
      return NextResponse.json({ error: "Invalid assignments data" }, { status: 400 });
    }

    const results = await assignOrderSequencingReads(id, body.assignments);
    return NextResponse.json({
      success: results.every((result) => result.success),
      results,
      message: "Assignments saved",
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

    console.error("[Order Files Legacy] PUT error:", error);
    return NextResponse.json(
      { error: "Failed to save assignments" },
      { status: 500 }
    );
  }
}
