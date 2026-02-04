import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import fs from "fs/promises";
import path from "path";

const ALLOWED_EXTENSIONS = new Set(["html", "htm"]);

const MIME_TYPES: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
};

/**
 * GET /api/files/preview?path=/absolute/path/to/report.html
 *
 * Serves pipeline output files (HTML reports, etc.) for in-browser viewing.
 * Validates that the file belongs to a pipeline run the user has access to.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get("path");

    if (!filePath) {
      return new NextResponse("Missing path parameter", { status: 400 });
    }

    // Must be an absolute path
    if (!path.isAbsolute(filePath)) {
      return new NextResponse("Path must be absolute", { status: 400 });
    }

    // Block path traversal
    const resolved = path.resolve(filePath);
    if (resolved !== filePath && resolved !== path.normalize(filePath)) {
      return new NextResponse("Invalid path", { status: 400 });
    }

    // Check extension
    const ext = path.extname(resolved).slice(1).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return new NextResponse(
        `File type .${ext} is not supported for preview. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
        { status: 400 }
      );
    }

    // Find a pipeline run whose runFolder is a parent of this file path.
    // This ensures users can only preview files from pipeline runs they own.
    const runs = await db.pipelineRun.findMany({
      where: {
        runFolder: { not: null },
      },
      select: {
        id: true,
        runFolder: true,
        study: { select: { userId: true } },
      },
    });

    const matchingRun = runs.find((run) => {
      if (!run.runFolder) return false;
      const folder = run.runFolder.endsWith("/")
        ? run.runFolder
        : run.runFolder + "/";
      return resolved.startsWith(folder) || resolved === run.runFolder;
    });

    if (!matchingRun) {
      return new NextResponse("File not found or access denied", {
        status: 404,
      });
    }

    // Non-admins can only view files from their own studies
    if (
      session.user.role !== "FACILITY_ADMIN" &&
      matchingRun.study?.userId !== session.user.id
    ) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    // Check file exists
    try {
      const stat = await fs.stat(resolved);
      if (!stat.isFile()) {
        return new NextResponse("Not a file", { status: 400 });
      }
    } catch {
      return new NextResponse("File not found", { status: 404 });
    }

    const content = await fs.readFile(resolved);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    return new NextResponse(content, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(content.length),
        // Prevent the browser from executing scripts in a different origin context
        "Content-Security-Policy": "script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[File Preview] Error:", error);
    return new NextResponse("Failed to preview file", { status: 500 });
  }
}
