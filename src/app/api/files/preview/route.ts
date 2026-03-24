import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { isDemoSession } from "@/lib/demo/server";
import { generateDemoFastqcReport } from "@/lib/demo/fastqc-report-template";
import fs from "fs/promises";
import path from "path";

const ALLOWED_EXTENSIONS = new Set(["html", "htm"]);

const MIME_TYPES: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
};

/**
 * For demo sessions, serve a generated FastQC report instead of reading from disk.
 * Parses the sample name and read direction from the path.
 */
function serveDemoFastqcReport(filePath: string): NextResponse | null {
  // Match paths like .../fastqc_reports/SampleName_R1_fastqc.html
  const match = filePath.match(/\/([^/]+)_(R[12])_fastqc\.html$/);
  if (!match) return null;
  const [, sampleName, direction] = match;
  const html = generateDemoFastqcReport(sampleName, direction as "R1" | "R2");
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html",
      "Content-Length": String(Buffer.byteLength(html)),
      "Content-Security-Policy": "script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * GET /api/files/preview?path=/absolute/path/to/report.html
 *
 * Serves pipeline output files (HTML reports, etc.) for in-browser viewing.
 * Validates that the file belongs to a pipeline run the user has access to.
 * In demo mode, serves generated reports instead of reading from disk.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    if (isDemoSession(session)) {
      const { searchParams } = new URL(request.url);
      const demoPath = searchParams.get("path");
      if (demoPath) {
        const demoResponse = serveDemoFastqcReport(demoPath);
        if (demoResponse) return demoResponse;
      }
      return new NextResponse("Preview is not available for this file in the demo.", {
        status: 403,
      });
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
