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

    return NextResponse.json({
      files: files.map((file) => ({
        ...file,
        modifiedAt: file.modifiedAt.toISOString(),
      })),
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
