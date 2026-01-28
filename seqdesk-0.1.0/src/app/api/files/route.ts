import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { scanDirectory, ScanOptions, FileInfo } from "@/lib/files";

interface FileWithAssignment extends FileInfo {
  assigned: boolean;
  readType: "R1" | "R2" | null;
  pairStatus: "paired" | "missing_r1" | "missing_r2" | "unknown" | null;
  checksum: string | null;
  quality?: {
    readCount: number | null;
    avgQuality: number | null;
    fastqcReport: string | null;
  };
  assignedTo?: {
    sampleId: string;
    sampleAlias: string | null;
    orderId: string;
    orderName: string;
    readField: "file1" | "file2";
    studyId: string | null;
    studyTitle: string | null;
  };
}

// Detect R1/R2 from filename
function detectReadType(filename: string): "R1" | "R2" | null {
  const lower = filename.toLowerCase();
  if (/_r2[._]/.test(lower) || /\.r2[._]/.test(lower) || /_2\./.test(lower)) {
    return "R2";
  }
  if (/_r1[._]/.test(lower) || /\.r1[._]/.test(lower) || /_1\./.test(lower)) {
    return "R1";
  }
  return null;
}

// Get the expected pair filename
function getPairFilename(filename: string, currentType: "R1" | "R2"): string {
  if (currentType === "R1") {
    return filename
      .replace(/_R1([._])/i, "_R2$1")
      .replace(/\.R1([._])/i, ".R2$1")
      .replace(/_1\./, "_2.");
  } else {
    return filename
      .replace(/_R2([._])/i, "_R1$1")
      .replace(/\.R2([._])/i, ".R1$1")
      .replace(/_2\./, "_1.");
  }
}

async function getSequencingFilesConfig(): Promise<{
  dataBasePath: string | null;
  config: {
    allowedExtensions: string[];
    scanDepth: number;
    ignorePatterns: string[];
    allowSingleEnd: boolean;
  };
}> {
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { dataBasePath: true, extraSettings: true },
  });

  const defaultConfig = {
    allowedExtensions: [".fastq.gz", ".fq.gz", ".fastq", ".fq"],
    scanDepth: 2,
    ignorePatterns: ["**/tmp/**", "**/undetermined/**"],
    allowSingleEnd: true,
  };

  let config = { ...defaultConfig };
  if (settings?.extraSettings) {
    try {
      const extra = JSON.parse(settings.extraSettings);
      if (extra.sequencingFiles) {
        config = { ...defaultConfig, ...extra.sequencingFiles };
      }
    } catch {
      // ignore
    }
  }

  return {
    dataBasePath: settings?.dataBasePath || null,
    config,
  };
}

// GET - list all files with assignment status
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json(
        { error: "Only facility admins can access the file browser" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const force = searchParams.get("force") === "true";
    const filter = searchParams.get("filter") || "all"; // all, assigned, unassigned
    const search = searchParams.get("search") || "";
    const extension = searchParams.get("extension") || "";

    // Get config
    const { dataBasePath, config } = await getSequencingFilesConfig();

    if (!dataBasePath) {
      return NextResponse.json({
        files: [],
        total: 0,
        assigned: 0,
        unassigned: 0,
        error: "Data base path not configured",
      });
    }

    // Scan directory
    const scanOptions: ScanOptions = {
      allowedExtensions: config.allowedExtensions,
      maxDepth: config.scanDepth,
      ignorePatterns: config.ignorePatterns,
    };

    let files: FileInfo[];
    try {
      files = await scanDirectory(dataBasePath, scanOptions, force);
    } catch (error) {
      return NextResponse.json({
        files: [],
        total: 0,
        assigned: 0,
        unassigned: 0,
        error: `Failed to scan directory: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }

    // Get all file assignments from database
    const reads = await db.read.findMany({
      where: {
        OR: [
          { file1: { not: null } },
          { file2: { not: null } },
        ],
      },
      select: {
        file1: true,
        file2: true,
        checksum1: true,
        checksum2: true,
        readCount1: true,
        readCount2: true,
        avgQuality1: true,
        avgQuality2: true,
        fastqcReport1: true,
        fastqcReport2: true,
        sample: {
          select: {
            sampleId: true,
            sampleAlias: true,
            orderId: true,
            order: {
              select: { name: true },
            },
            studyId: true,
            study: {
              select: { id: true, title: true },
            },
          },
        },
      },
    });

    // Build assignment map, checksum map, and quality map
    const assignmentMap = new Map<string, FileWithAssignment["assignedTo"]>();
    const checksumMap = new Map<string, string>();
    const qualityMap = new Map<string, FileWithAssignment["quality"]>();

    for (const read of reads) {
      if (read.file1) {
        assignmentMap.set(read.file1, {
          sampleId: read.sample.sampleId,
          sampleAlias: read.sample.sampleAlias,
          orderId: read.sample.orderId,
          orderName: read.sample.order.name || "Unnamed Order",
          readField: "file1",
          studyId: read.sample.studyId,
          studyTitle: read.sample.study?.title || null,
        });
        if (read.checksum1) {
          checksumMap.set(read.file1, read.checksum1);
        }
        qualityMap.set(read.file1, {
          readCount: read.readCount1,
          avgQuality: read.avgQuality1,
          fastqcReport: read.fastqcReport1,
        });
      }
      if (read.file2) {
        assignmentMap.set(read.file2, {
          sampleId: read.sample.sampleId,
          sampleAlias: read.sample.sampleAlias,
          orderId: read.sample.orderId,
          orderName: read.sample.order.name || "Unnamed Order",
          readField: "file2",
          studyId: read.sample.studyId,
          studyTitle: read.sample.study?.title || null,
        });
        if (read.checksum2) {
          checksumMap.set(read.file2, read.checksum2);
        }
        qualityMap.set(read.file2, {
          readCount: read.readCount2,
          avgQuality: read.avgQuality2,
          fastqcReport: read.fastqcReport2,
        });
      }
    }

    // Build a set of all filenames for pair detection
    const allFilenames = new Set(files.map(f => f.filename.toLowerCase()));

    // Enrich files with assignment info, read type, pair status, checksum, and quality
    let enrichedFiles: FileWithAssignment[] = files.map((file) => {
      const assignment = assignmentMap.get(file.relativePath);
      const readType = detectReadType(file.filename);
      const checksum = checksumMap.get(file.relativePath) || null;
      const quality = qualityMap.get(file.relativePath);

      // Determine pair status
      let pairStatus: FileWithAssignment["pairStatus"] = null;
      if (readType) {
        const pairFilename = getPairFilename(file.filename, readType).toLowerCase();
        const hasPair = allFilenames.has(pairFilename);
        if (hasPair) {
          pairStatus = "paired";
        } else if (readType === "R1") {
          pairStatus = "missing_r2";
        } else {
          pairStatus = "missing_r1";
        }
      } else {
        pairStatus = "unknown";
      }

      return {
        ...file,
        assigned: !!assignment,
        readType,
        pairStatus,
        checksum,
        quality,
        assignedTo: assignment,
      };
    });

    // Apply filters
    if (filter === "assigned") {
      enrichedFiles = enrichedFiles.filter((f) => f.assigned);
    } else if (filter === "unassigned") {
      enrichedFiles = enrichedFiles.filter((f) => !f.assigned);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      enrichedFiles = enrichedFiles.filter(
        (f) =>
          f.filename.toLowerCase().includes(searchLower) ||
          f.relativePath.toLowerCase().includes(searchLower) ||
          f.assignedTo?.sampleId.toLowerCase().includes(searchLower) ||
          f.assignedTo?.orderName.toLowerCase().includes(searchLower) ||
          f.assignedTo?.studyTitle?.toLowerCase().includes(searchLower)
      );
    }

    if (extension) {
      enrichedFiles = enrichedFiles.filter((f) =>
        f.filename.toLowerCase().endsWith(extension.toLowerCase())
      );
    }

    // Calculate stats (before filtering for accurate counts)
    const totalFiles = files.length;
    const assignedCount = files.filter((f) => assignmentMap.has(f.relativePath)).length;
    const unassignedCount = totalFiles - assignedCount;

    // Remove absolutePath from response
    const safeFiles = enrichedFiles.map(({ absolutePath, ...rest }) => rest);

    return NextResponse.json({
      files: safeFiles,
      total: totalFiles,
      assigned: assignedCount,
      unassigned: unassignedCount,
      filtered: safeFiles.length,
      dataBasePath,
      config: {
        allowedExtensions: config.allowedExtensions,
        scanDepth: config.scanDepth,
      },
    });
  } catch (error) {
    console.error("[Files API] Error:", error);
    return NextResponse.json(
      { error: "Failed to list files" },
      { status: 500 }
    );
  }
}
