import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { isDemoSession } from "@/lib/demo/server";
import { serveDemoPipelineFile } from "@/lib/demo/pipeline-preview";
import { canReadPipelineRun } from "@/lib/pipelines/run-visibility";
import { safeJoin } from "@/lib/files/paths";
import { getSequencingFilesConfig } from "@/lib/files/sequencing-config";
import {
  canUserAccessDeliveryArtifact,
  findSequencingDeliveryArtifactByPath,
} from "@/lib/sequencing/delivery";
import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { Readable } from "stream";

const ALLOWED_EXTENSIONS = new Set([
  "html",
  "htm",
  "pdf",
  "txt",
  "tsv",
  "csv",
  "log",
  "json",
]);

const MIME_TYPES: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  log: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
};

const MAX_PREVIEW_BYTES = 100 * 1024 * 1024;

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
        const demoResponse = await serveDemoPipelineFile(demoPath);
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

    let resolved: string;
    if (path.isAbsolute(filePath)) {
      // Block path traversal
      resolved = path.resolve(filePath);
      if (resolved !== filePath && resolved !== path.normalize(filePath)) {
        return new NextResponse("Invalid path", { status: 400 });
      }
    } else {
      const { dataBasePath } = await getSequencingFilesConfig();
      if (!dataBasePath) {
        return new NextResponse("Data base path not configured", { status: 400 });
      }

      try {
        resolved = safeJoin(dataBasePath, filePath);
      } catch {
        return new NextResponse("Invalid path", { status: 400 });
      }
    }

    // Check extension
    const ext = path.extname(resolved).slice(1).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return new NextResponse(
        `File type .${ext} is not supported for preview. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
        { status: 400 }
      );
    }

    if (path.isAbsolute(filePath)) {
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
          order: { select: { userId: true } },
          selectedResultSelections: {
            select: { id: true },
            take: 1,
          },
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

      // Non-admins can only view files from their own studies or orders.
      if (!canReadPipelineRun(session.user, matchingRun)) {
        return new NextResponse("Forbidden", { status: 403 });
      }
    } else {
      const artifact = await findSequencingDeliveryArtifactByPath(filePath);
      const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";
      if (!artifact && !isFacilityAdmin) {
        return new NextResponse("File not found or access denied", { status: 404 });
      }
      if (artifact && !isFacilityAdmin && !canUserAccessDeliveryArtifact(session.user, artifact)) {
        return new NextResponse("Forbidden", { status: 403 });
      }
    }

    let fileSize = 0;
    try {
      const stat = await fs.stat(resolved);
      if (!stat.isFile()) {
        return new NextResponse("Not a file", { status: 400 });
      }
      fileSize = Number.isFinite(stat.size) ? stat.size : 0;
    } catch {
      return new NextResponse("File not found", { status: 404 });
    }

    if (fileSize > MAX_PREVIEW_BYTES) {
      return new NextResponse(
        `File is too large to preview (${Math.ceil(fileSize / 1024 / 1024)} MB).`,
        { status: 413 }
      );
    }

    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const stream = Readable.toWeb(createReadStream(resolved)) as BodyInit;

    return new NextResponse(stream, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileSize),
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
