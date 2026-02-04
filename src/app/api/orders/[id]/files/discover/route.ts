import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSequencingFilesConfig } from "@/lib/files/sequencing-config";
import {
  scanDirectory,
  findFilesForSample,
  ScanOptions,
  FileMatchSuggestion,
} from "@/lib/files";

// Status after which files can be discovered/assigned
const FILES_ASSIGNABLE_STATUSES = ["SUBMITTED", "COMPLETED"];

interface DiscoveryResult {
  sampleId: string;
  sampleAlias: string | null;
  suggestion: FileMatchSuggestion;
  autoAssigned: boolean;
}

// POST - discover files for an order's samples
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

    if (!isFacilityAdmin) {
      return NextResponse.json(
        { error: "Only facility admins can discover files" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { autoAssign = false, force = false } = body as {
      autoAssign?: boolean;
      force?: boolean;
    };

    // Get order with samples
    const order = await db.order.findUnique({
      where: { id },
      include: {
        samples: {
          include: { reads: true },
          orderBy: { sampleId: "asc" },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (!FILES_ASSIGNABLE_STATUSES.includes(order.status)) {
      return NextResponse.json(
        { error: "Files cannot be discovered in this order status" },
        { status: 400 }
      );
    }

    // Get config
    const { dataBasePath, config } = await getSequencingFilesConfig();

    if (!dataBasePath) {
      return NextResponse.json(
        { error: "Data base path not configured. Please configure it in Settings." },
        { status: 400 }
      );
    }

    // Scan directory
    const scanOptions: ScanOptions = {
      allowedExtensions: config.allowedExtensions,
      maxDepth: config.scanDepth,
      ignorePatterns: config.ignorePatterns,
    };

    let files;
    try {
      files = await scanDirectory(dataBasePath, scanOptions, force);
    } catch (error) {
      console.error("[Discover] Scan error:", error);
      return NextResponse.json(
        { error: `Failed to scan directory: ${error instanceof Error ? error.message : "Unknown error"}` },
        { status: 500 }
      );
    }

    // Find matches for each sample
    const results: DiscoveryResult[] = [];
    let autoAssignedCount = 0;

    for (const sample of order.samples) {
      const existingRead = sample.reads[0];
      const hasExistingAssignment = !!(existingRead?.file1 || existingRead?.file2);

      // Skip samples that already have assignments (unless forcing)
      if (hasExistingAssignment && !force) {
        results.push({
          sampleId: sample.sampleId,
          sampleAlias: sample.sampleAlias,
          suggestion: {
            status: "exact",
            read1: null,
            read2: null,
            alternatives: [],
            confidence: 1,
            matchedBy: "existing",
          },
          autoAssigned: false,
        });
        continue;
      }

      // Find matching files
      const suggestion = findFilesForSample(
        {
          sampleId: sample.sampleId,
          sampleAlias: sample.sampleAlias,
          sampleTitle: sample.sampleTitle,
        },
        files,
        config.allowSingleEnd
      );

      let autoAssigned = false;

      // Auto-assign if enabled and we have an exact/partial match with high confidence
      const shouldAutoAssign =
        (autoAssign || config.autoAssign) &&
        suggestion.status === "exact" &&
        suggestion.confidence >= 0.9 &&
        suggestion.read1;

      if (shouldAutoAssign && suggestion.read1) {
        try {
          const read1Path = suggestion.read1.relativePath;
          const read2Path = suggestion.read2?.relativePath || null;

          if (existingRead) {
            await db.read.update({
              where: { id: existingRead.id },
              data: {
                file1: read1Path,
                file2: read2Path,
              },
            });
          } else {
            await db.read.create({
              data: {
                sampleId: sample.id,
                file1: read1Path,
                file2: read2Path,
              },
            });
          }

          autoAssigned = true;
          autoAssignedCount++;
        } catch (error) {
          console.error(`[Discover] Auto-assign error for ${sample.sampleId}:`, error);
        }
      }

      // Convert FileInfo to relative paths for the response
      results.push({
        sampleId: sample.sampleId,
        sampleAlias: sample.sampleAlias,
        suggestion: {
          ...suggestion,
          read1: suggestion.read1
            ? { ...suggestion.read1, absolutePath: undefined } as never
            : null,
          read2: suggestion.read2
            ? { ...suggestion.read2, absolutePath: undefined } as never
            : null,
          alternatives: suggestion.alternatives.map((alt) => ({
            ...alt,
            read1: { ...alt.read1, absolutePath: undefined } as never,
            read2: alt.read2
              ? { ...alt.read2, absolutePath: undefined } as never
              : null,
          })),
        },
        autoAssigned,
      });
    }

    // Summary stats
    const exactMatches = results.filter(
      (r) => r.suggestion.status === "exact" || r.suggestion.matchedBy === "existing"
    ).length;
    const partialMatches = results.filter((r) => r.suggestion.status === "partial").length;
    const ambiguous = results.filter((r) => r.suggestion.status === "ambiguous").length;
    const noMatch = results.filter((r) => r.suggestion.status === "none").length;

    return NextResponse.json({
      success: true,
      scannedFiles: files.length,
      results,
      summary: {
        total: results.length,
        exactMatches,
        partialMatches,
        ambiguous,
        noMatch,
        autoAssigned: autoAssignedCount,
      },
    });
  } catch (error) {
    console.error("[Discover] Error:", error);
    return NextResponse.json(
      { error: "Failed to discover files" },
      { status: 500 }
    );
  }
}
