import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSequencingFilesConfig } from "@/lib/files/sequencing-config";
import { scanDirectory, ScanOptions, FileInfo } from "@/lib/files";
import * as fs from "fs";
import * as crypto from "crypto";
import * as path from "path";

interface FileWithAssignment extends FileInfo {
  assigned: boolean;
  existsOnDisk: boolean;
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

interface AutoChecksumSummary {
  requested: boolean;
  attempted: number;
  updated: number;
  failed: number;
  skippedMissingFiles: number;
  remaining: number;
  limit: number;
}

const AUTO_CHECKSUM_LIMIT = 50;

async function calculateMD5(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
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
    const autoChecksumRequested =
      force && searchParams.get("autoChecksum") === "true";
    const filter = searchParams.get("filter") || "all"; // all, assigned, unassigned, present, missing
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
        presentOnDisk: 0,
        missingOnDisk: 0,
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
        presentOnDisk: 0,
        missingOnDisk: 0,
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
        id: true,
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

    let autoChecksumSummary: AutoChecksumSummary | undefined;
    if (autoChecksumRequested) {
      const filePathMap = new Map(files.map((file) => [file.relativePath, file.absolutePath]));
      const candidatePairs: Array<{
        readId: string;
        field: "checksum1" | "checksum2";
        relativePath: string;
      }> = [];

      for (const read of reads) {
        if (read.file1 && !read.checksum1) {
          candidatePairs.push({
            readId: read.id,
            field: "checksum1",
            relativePath: read.file1,
          });
        }
        if (read.file2 && !read.checksum2) {
          candidatePairs.push({
            readId: read.id,
            field: "checksum2",
            relativePath: read.file2,
          });
        }
      }

      const uniqueCandidatePaths = Array.from(
        new Set(candidatePairs.map((candidate) => candidate.relativePath))
      ).sort((a, b) => a.localeCompare(b));
      const selectedPaths = uniqueCandidatePaths.slice(0, AUTO_CHECKSUM_LIMIT);
      const selectedPathSet = new Set(selectedPaths);
      const checksumByPath = new Map<string, string>();

      let failed = 0;
      let skippedMissingFiles = 0;

      for (const relativePath of selectedPaths) {
        const absolutePath = filePathMap.get(relativePath);
        if (!absolutePath) {
          skippedMissingFiles += 1;
          continue;
        }

        try {
          const checksum = await calculateMD5(absolutePath);
          checksumByPath.set(relativePath, checksum);
        } catch {
          failed += 1;
        }
      }

      let updated = 0;
      const readById = new Map(reads.map((read) => [read.id, read]));
      for (const candidate of candidatePairs) {
        if (!selectedPathSet.has(candidate.relativePath)) continue;

        const checksum = checksumByPath.get(candidate.relativePath);
        if (!checksum) continue;

        try {
          await db.read.update({
            where: { id: candidate.readId },
            data: {
              [candidate.field]: checksum,
            },
          });

          const targetRead = readById.get(candidate.readId);
          if (targetRead) {
            if (candidate.field === "checksum1") {
              targetRead.checksum1 = checksum;
            } else {
              targetRead.checksum2 = checksum;
            }
          }
          updated += 1;
        } catch {
          failed += 1;
        }
      }

      autoChecksumSummary = {
        requested: true,
        attempted: selectedPaths.length,
        updated,
        failed,
        skippedMissingFiles,
        remaining: Math.max(0, uniqueCandidatePaths.length - selectedPaths.length),
        limit: AUTO_CHECKSUM_LIMIT,
      };
    }

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

    // Build sets for pair detection and on-disk presence checks
    const allFilenames = new Set(files.map((f) => f.filename.toLowerCase()));
    const scannedRelativePaths = new Set(files.map((f) => f.relativePath));

    // Enrich scanned files with assignment info, read type, pair status, checksum, and quality
    const scannedFiles: FileWithAssignment[] = files.map((file) => {
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
        existsOnDisk: true,
        readType,
        pairStatus,
        checksum,
        quality,
        assignedTo: assignment,
      };
    });

    // Include assigned records that no longer exist on disk so admins can resolve stale assignments.
    const missingAssignedFiles: FileWithAssignment[] = [];
    for (const [relativePath, assignment] of assignmentMap.entries()) {
      if (scannedRelativePaths.has(relativePath)) {
        continue;
      }

      const filename = path.basename(relativePath);
      missingAssignedFiles.push({
        absolutePath: "",
        relativePath,
        filename,
        size: 0,
        modifiedAt: new Date(0),
        assigned: true,
        existsOnDisk: false,
        readType: detectReadType(filename),
        pairStatus: null,
        checksum: checksumMap.get(relativePath) || null,
        quality: qualityMap.get(relativePath),
        assignedTo: assignment,
      });
    }

    const allFiles: FileWithAssignment[] = [...scannedFiles, ...missingAssignedFiles].sort((a, b) => {
      if (a.existsOnDisk !== b.existsOnDisk) {
        return a.existsOnDisk ? -1 : 1;
      }
      return a.filename.localeCompare(b.filename);
    });

    let enrichedFiles: FileWithAssignment[] = [...allFiles];

    // Apply filters
    if (filter === "assigned") {
      enrichedFiles = enrichedFiles.filter((f) => f.assigned);
    } else if (filter === "unassigned") {
      enrichedFiles = enrichedFiles.filter((f) => !f.assigned);
    } else if (filter === "present") {
      enrichedFiles = enrichedFiles.filter((f) => f.existsOnDisk);
    } else if (filter === "missing") {
      enrichedFiles = enrichedFiles.filter((f) => !f.existsOnDisk);
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
    const totalFiles = allFiles.length;
    const assignedCount = allFiles.filter((f) => f.assigned).length;
    const unassignedCount = totalFiles - assignedCount;
    const missingOnDisk = allFiles.filter((f) => !f.existsOnDisk).length;
    const presentOnDisk = totalFiles - missingOnDisk;

    // Remove absolutePath from response
    const safeFiles = enrichedFiles.map((file) => {
      const { absolutePath: _absolutePath, ...rest } = file;
      void _absolutePath;
      return rest;
    });

    return NextResponse.json({
      files: safeFiles,
      total: totalFiles,
      assigned: assignedCount,
      unassigned: unassignedCount,
      presentOnDisk,
      missingOnDisk,
      filtered: safeFiles.length,
      autoChecksum: autoChecksumSummary,
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
