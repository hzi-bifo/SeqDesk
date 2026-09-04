import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveContainedPath } from "@/lib/explore/storage";
import { ExploreRouteError, exploreErrorResponse, loadAccessibleRun, requireExploreSession } from "../../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; artifactId: string }> };

const CONTENT_TYPES: Record<string, string> = {
  "plotly-json": "application/json; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  svg: "image/svg+xml",
  html: "text/html; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  pdf: "application/pdf",
};

/**
 * Serve one artifact of a run. Files are only ever read from inside the
 * run folder (lexical and realpath checks). HTML is served with a strict
 * sandboxing content security policy so a report cannot reach the app.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id, artifactId } = await context.params;
    const run = await loadAccessibleRun(session, id, "read");
    const artifact = await db.exploreArtifact.findFirst({ where: { id: artifactId, runId: id } });
    if (!artifact || !run.runFolder) throw new ExploreRouteError(404, "Not found");
    const filePath = await resolveContainedPath(run.runFolder, artifact.path).catch(() => null);
    if (!filePath) throw new ExploreRouteError(404, "Not found");
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) throw new ExploreRouteError(404, "Not found");

    const download = request.nextUrl.searchParams.get("download") === "1";
    const contentType = CONTENT_TYPES[artifact.format] ?? "application/octet-stream";
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    };
    const fileName = path.basename(filePath).replace(/[^A-Za-z0-9._-]+/g, "_");
    headers["Content-Disposition"] = `${download ? "attachment" : "inline"}; filename="${fileName}"`;
    if (artifact.format === "html") {
      headers["Content-Security-Policy"] = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; sandbox allow-scripts";
    }
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
    return new NextResponse(stream, { headers });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
