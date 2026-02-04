import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureWithinBase } from "@/lib/files";
import * as fs from "fs/promises";
import * as path from "path";

// POST - bulk delete files from disk and remove associated Read records
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { filePaths } = body as { filePaths?: string[] };

    if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
      return NextResponse.json(
        { error: "filePaths must be a non-empty array" },
        { status: 400 }
      );
    }

    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { dataBasePath: true },
    });

    if (!settings?.dataBasePath) {
      return NextResponse.json(
        { error: "Data base path not configured" },
        { status: 400 }
      );
    }

    const resolvedBase = path.resolve(settings.dataBasePath);

    let deletedCount = 0;
    let recordsRemoved = 0;
    const errors: Array<{ path: string; error: string }> = [];

    for (const filePath of filePaths) {
      try {
        // Validate path is within base directory
        const absPath = ensureWithinBase(resolvedBase, filePath);

        // Find and delete any Read records referencing this file
        const readsWithFile1 = await db.read.findMany({
          where: { file1: filePath },
          select: { id: true, file2: true },
        });
        const readsWithFile2 = await db.read.findMany({
          where: { file2: filePath },
          select: { id: true, file1: true },
        });

        // For reads where this file is file1: clear file1 (or delete record if file2 also empty)
        for (const read of readsWithFile1) {
          if (!read.file2) {
            await db.read.delete({ where: { id: read.id } });
          } else {
            await db.read.update({
              where: { id: read.id },
              data: { file1: null },
            });
          }
          recordsRemoved++;
        }

        // For reads where this file is file2: clear file2 (or delete record if file1 also empty)
        for (const read of readsWithFile2) {
          if (!read.file1) {
            await db.read.delete({ where: { id: read.id } });
          } else {
            await db.read.update({
              where: { id: read.id },
              data: { file2: null },
            });
          }
          recordsRemoved++;
        }

        // Delete the physical file
        await fs.rm(absPath);
        deletedCount++;
      } catch (err) {
        errors.push({
          path: filePath,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      success: true,
      deletedCount,
      recordsRemoved,
      errors: errors.length > 0 ? errors : undefined,
      total: filePaths.length,
    });
  } catch (error) {
    console.error("[File Delete] Error:", error);
    return NextResponse.json(
      { error: "Failed to delete files" },
      { status: 500 }
    );
  }
}
