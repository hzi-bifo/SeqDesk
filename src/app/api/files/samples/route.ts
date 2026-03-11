import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// Statuses where files can be assigned
const FILES_ASSIGNABLE_STATUSES = ["SUBMITTED", "COMPLETED"];

// Extract sample identifier from filename by removing common suffixes
function extractSampleIdFromFilename(filename: string): string {
  let id = filename.toLowerCase();

  // Remove common extensions
  id = id.replace(/\.(fastq|fq|gz|bam|sam|fasta|fa)$/gi, "");
  id = id.replace(/\.(fastq|fq)\.gz$/gi, "");

  // Remove read indicators
  id = id.replace(/_r[12]$/i, "");
  id = id.replace(/\.r[12]$/i, "");
  id = id.replace(/_[12]$/i, "");

  // Remove Illumina suffixes
  id = id.replace(/_001$/i, "");
  id = id.replace(/_l\d{3}$/i, ""); // Lane info
  id = id.replace(/_s\d+$/i, ""); // Sample number

  return id.trim();
}

// Calculate match score between filename and sample identifiers
function calculateMatchScore(
  filename: string,
  sampleId: string,
  sampleAlias: string | null,
  sampleTitle: string | null
): { score: number; matchType: "exact" | "strong" | "partial" | "none" } {
  const fileId = extractSampleIdFromFilename(filename);
  const normalizedSampleId = sampleId.toLowerCase().trim();
  const normalizedAlias = sampleAlias?.toLowerCase().trim() || "";
  const normalizedTitle = sampleTitle?.toLowerCase().trim() || "";

  // Check for exact matches
  if (fileId === normalizedSampleId || fileId === normalizedAlias) {
    return { score: 1.0, matchType: "exact" };
  }

  // Check if file ID contains sample ID or vice versa
  if (fileId.includes(normalizedSampleId) || normalizedSampleId.includes(fileId)) {
    const lenRatio = Math.min(fileId.length, normalizedSampleId.length) /
                     Math.max(fileId.length, normalizedSampleId.length);
    return { score: 0.7 + (lenRatio * 0.2), matchType: "strong" };
  }

  // Check alias
  if (normalizedAlias && (fileId.includes(normalizedAlias) || normalizedAlias.includes(fileId))) {
    const lenRatio = Math.min(fileId.length, normalizedAlias.length) /
                     Math.max(fileId.length, normalizedAlias.length);
    return { score: 0.6 + (lenRatio * 0.2), matchType: "strong" };
  }

  // Check title (weaker match)
  if (normalizedTitle && (fileId.includes(normalizedTitle) || normalizedTitle.includes(fileId))) {
    return { score: 0.4, matchType: "partial" };
  }

  // Check if they share a common prefix (at least 3 chars)
  const minLen = Math.min(fileId.length, normalizedSampleId.length);
  if (minLen >= 3) {
    let commonPrefix = 0;
    for (let i = 0; i < minLen; i++) {
      if (fileId[i] === normalizedSampleId[i]) {
        commonPrefix++;
      } else {
        break;
      }
    }
    if (commonPrefix >= 3) {
      return { score: 0.3 + (commonPrefix / minLen) * 0.3, matchType: "partial" };
    }
  }

  return { score: 0, matchType: "none" };
}

// GET - search samples that can receive file assignments
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json(
        { error: "Only facility admins can access this" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const needsR1 = searchParams.get("needsR1") === "true";
    const needsR2 = searchParams.get("needsR2") === "true";
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const filename = searchParams.get("filename") || ""; // For match scoring

    // Build where clause
    const whereClause: Record<string, unknown> = {
      order: {
        status: { in: FILES_ASSIGNABLE_STATUSES },
      },
    };

    if (search) {
      whereClause.OR = [
        { sampleId: { contains: search, mode: "insensitive" } },
        { sampleAlias: { contains: search, mode: "insensitive" } },
        { sampleTitle: { contains: search, mode: "insensitive" } },
        { order: { name: { contains: search, mode: "insensitive" } } },
        { order: { orderNumber: { contains: search, mode: "insensitive" } } },
      ];
    }

    // Get samples with their current reads
    const samples = await db.sample.findMany({
      where: whereClause,
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            name: true,
            status: true,
          },
        },
        reads: {
          select: {
            id: true,
            file1: true,
            file2: true,
          },
        },
      },
      take: limit,
      orderBy: [
        { order: { updatedAt: "desc" } },
        { sampleId: "asc" },
      ],
    });

    // Transform and filter based on needs
    let results = samples.map((sample) => {
      const read = sample.reads[0];

      // Calculate match score if filename provided
      const match = filename
        ? calculateMatchScore(filename, sample.sampleId, sample.sampleAlias, sample.sampleTitle)
        : { score: 0, matchType: "none" as const };

      return {
        id: sample.id,
        sampleId: sample.sampleId,
        sampleAlias: sample.sampleAlias,
        sampleTitle: sample.sampleTitle,
        orderId: sample.order.id,
        orderNumber: sample.order.orderNumber,
        orderName: sample.order.name,
        orderStatus: sample.order.status,
        hasR1: !!read?.file1,
        hasR2: !!read?.file2,
        currentR1: read?.file1 || null,
        currentR2: read?.file2 || null,
        matchScore: match.score,
        matchType: match.matchType,
      };
    });

    // Filter by what files are needed
    if (needsR1) {
      results = results.filter((s) => !s.hasR1);
    }
    if (needsR2) {
      results = results.filter((s) => !s.hasR2);
    }

    // Sort by match score (best matches first), then by sampleId
    if (filename) {
      results.sort((a, b) => {
        if (b.matchScore !== a.matchScore) {
          return b.matchScore - a.matchScore;
        }
        return a.sampleId.localeCompare(b.sampleId);
      });
    }

    return NextResponse.json({
      samples: results,
      total: results.length,
    });
  } catch (error) {
    console.error("[Files Samples API] Error:", error);
    return NextResponse.json(
      { error: "Failed to search samples" },
      { status: 500 }
    );
  }
}
