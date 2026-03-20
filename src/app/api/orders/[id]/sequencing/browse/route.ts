import { NextRequest, NextResponse } from "next/server";
import { getSequencingFilesConfig } from "@/lib/files/sequencing-config";
import { db } from "@/lib/db";
import { browseSequencingStorageFiles } from "@/lib/sequencing/browse";
import {
  requireFacilityAdminSequencingSession,
  SequencingApiError,
} from "@/lib/sequencing/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFacilityAdminSequencingSession();
    const { id } = await params;
    const order = await db.order.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? "";
    const limit = Number(searchParams.get("limit") ?? "250");
    const { dataBasePath, config } = await getSequencingFilesConfig();

    if (!dataBasePath) {
      return NextResponse.json(
        { error: "Data base path not configured" },
        { status: 400 }
      );
    }

    const files = await browseSequencingStorageFiles(dataBasePath, {
      search,
      maxDepth: config.scanDepth + 3,
      ignorePatterns: config.ignorePatterns,
      limit: Number.isFinite(limit) ? limit : 250,
    });

    // Enrich with assignment info from DB
    const filePaths = files.map((f) => f.relativePath);
    const reads = filePaths.length > 0
      ? await db.read.findMany({
          where: {
            OR: [
              { file1: { in: filePaths } },
              { file2: { in: filePaths } },
            ],
          },
          select: {
            file1: true,
            file2: true,
            sample: {
              select: {
                sampleId: true,
                orderId: true,
                order: { select: { name: true } },
              },
            },
          },
        })
      : [];

    const assignmentMap = new Map<string, { sampleId: string; orderId: string; orderName: string | null; role: "R1" | "R2" }>();
    for (const read of reads) {
      if (read.file1) {
        assignmentMap.set(read.file1, {
          sampleId: read.sample.sampleId,
          orderId: read.sample.orderId,
          orderName: read.sample.order.name,
          role: "R1",
        });
      }
      if (read.file2) {
        assignmentMap.set(read.file2, {
          sampleId: read.sample.sampleId,
          orderId: read.sample.orderId,
          orderName: read.sample.order.name,
          role: "R2",
        });
      }
    }

    return NextResponse.json({
      files: files.map((file) => {
        const assignment = assignmentMap.get(file.relativePath);
        return {
          ...file,
          modifiedAt: file.modifiedAt.toISOString(),
          assignedTo: assignment ?? null,
        };
      }),
    });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[Order Sequencing] browse GET error:", error);
    return NextResponse.json(
      { error: "Failed to browse sequencing storage" },
      { status: 500 }
    );
  }
}
