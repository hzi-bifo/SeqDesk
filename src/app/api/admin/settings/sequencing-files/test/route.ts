import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import * as fs from "node:fs/promises";
import { inspectDataStoragePath } from "@/lib/files/data-storage-path-validation";

// POST - test if a path is accessible and list file counts
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { basePath, allowedExtensions = [".fastq.gz", ".fq.gz"] } = body;

    if (!basePath) {
      return NextResponse.json({
        valid: false,
        error: "No path provided"
      });
    }

    const inspection = await inspectDataStoragePath(basePath);
    if (!inspection.valid || !inspection.resolvedPath) {
      return NextResponse.json({
        valid: false,
        error: inspection.error || "Invalid data storage path",
      });
    }
    const resolvedPath = inspection.resolvedPath;

    // Count files with matching extensions (non-recursive for quick test)
    let totalFiles = 0;
    let matchingFiles = 0;

    try {
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile()) {
          totalFiles++;
          // Handle .fastq.gz (double extension)
          const fullName = entry.name.toLowerCase();
          const isMatch = allowedExtensions.some((allowedExt: string) =>
            fullName.endsWith(allowedExt.toLowerCase())
          );
          if (isMatch) {
            matchingFiles++;
          }
        }
      }
    } catch (error) {
      return NextResponse.json({
        valid: false,
        error: `Failed to read directory: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }

    return NextResponse.json({
      valid: true,
      configuredPath: inspection.configuredPath,
      resolvedPath,
      readable: inspection.readable,
      writable: inspection.writable,
      totalFiles,
      matchingFiles,
      message: matchingFiles > 0
        ? `Found ${matchingFiles} sequencing file${matchingFiles !== 1 ? "s" : ""} (${totalFiles} total files in root)`
        : totalFiles > 0
          ? `No sequencing files found yet (${totalFiles} other files in root)`
          : "Directory is empty",
    });
  } catch (error) {
    console.error("[Test Path] Error:", error);
    return NextResponse.json({
      valid: false,
      error: "Failed to test path"
    }, { status: 500 });
  }
}
