import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getResolvedDataBasePath } from "@/lib/files/data-base-path";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// Calculate MD5 checksum of a file
async function calculateMD5(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function isWithinBasePath(basePath: string, candidatePath: string): boolean {
  const normalizedBasePath = path.resolve(basePath);
  const normalizedCandidatePath = path.resolve(candidatePath);
  return (
    normalizedCandidatePath === normalizedBasePath ||
    normalizedCandidatePath.startsWith(`${normalizedBasePath}${path.sep}`)
  );
}

// POST - calculate MD5 checksum for one or more files
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json(
        { error: "Only facility admins can calculate checksums" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { filePaths } = body as { filePaths: string[] };

    if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
      return NextResponse.json(
        { error: "filePaths array is required" },
        { status: 400 }
      );
    }

    // Limit to 50 files at a time
    if (filePaths.length > 50) {
      return NextResponse.json(
        { error: "Maximum 50 files at a time" },
        { status: 400 }
      );
    }

    // Get data base path
    const resolvedDataBasePath = await getResolvedDataBasePath();

    if (!resolvedDataBasePath.dataBasePath) {
      return NextResponse.json(
        { error: "Data base path not configured" },
        { status: 400 }
      );
    }

    const results: Array<{
      filePath: string;
      checksum?: string;
      updatedReadRecord?: boolean;
      warning?: string;
      error?: string;
    }> = [];

    const normalizedBasePath = path.resolve(resolvedDataBasePath.dataBasePath);

    for (const relativePath of filePaths) {
      try {
        const absolutePath = path.resolve(resolvedDataBasePath.dataBasePath, relativePath);

        if (!isWithinBasePath(normalizedBasePath, absolutePath)) {
          results.push({
            filePath: relativePath,
            error: "Path is outside configured data base path",
          });
          continue;
        }

        // Verify file exists
        if (!fs.existsSync(absolutePath)) {
          results.push({ filePath: relativePath, error: "File not found" });
          continue;
        }

        // Calculate MD5
        const checksum = await calculateMD5(absolutePath);

        // Find the Read record for this file and update it
        const read = await db.read.findFirst({
          where: {
            OR: [
              { file1: relativePath },
              { file2: relativePath },
            ],
          },
        });

        if (read) {
          const isFile1 = read.file1 === relativePath;
          await db.read.update({
            where: { id: read.id },
            data: {
              [isFile1 ? "checksum1" : "checksum2"]: checksum,
            },
          });
          results.push({ filePath: relativePath, checksum, updatedReadRecord: true });
        } else {
          results.push({
            filePath: relativePath,
            checksum,
            updatedReadRecord: false,
            warning: "No assigned read record found; checksum was not stored in database",
          });
        }
      } catch (err) {
        results.push({
          filePath: relativePath,
          error: err instanceof Error ? err.message : "Failed to calculate checksum",
        });
      }
    }

    const successful = results.filter((r) => r.checksum).length;
    const failed = results.filter((r) => r.error).length;
    const updatedReadRecords = results.filter((r) => r.updatedReadRecord).length;
    const notLinkedToRead = results.filter(
      (r) => r.checksum && r.updatedReadRecord === false
    ).length;

    return NextResponse.json({
      success: true,
      results,
      summary: {
        total: filePaths.length,
        successful,
        failed,
        updatedReadRecords,
        notLinkedToRead,
      },
    });
  } catch (error) {
    console.error("[Files Checksum API] Error:", error);
    return NextResponse.json(
      { error: "Failed to calculate checksums" },
      { status: 500 }
    );
  }
}
