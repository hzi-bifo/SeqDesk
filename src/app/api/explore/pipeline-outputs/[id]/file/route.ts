import fs from "fs/promises";
import { createReadStream } from "fs";
import { Readable } from "stream";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { exploreBuildContext, requireTargetAccess } from "@/lib/explore/authorization";
import { accessiblePipelineArtifacts } from "@/lib/explore/pipeline-outputs";
import { resolveTableSpec } from "@/lib/explore/builders/pipeline-table";
import { outputFileView } from "@/lib/explore/pipeline-output-types";
import { resolveContainedPath } from "@/lib/explore/storage";
import { parsePipelineTable } from "@/lib/explore/parsers/pipeline-table";
import { exploreErrorResponse, requireExploreSession } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PREVIEW_BYTES = 1024 * 1024;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireExploreSession();
    const scope = request.nextUrl.searchParams.get("targetKey") ?? "";
    const target = await requireTargetAccess(session, scope, "read");
    const { id } = await params;
    const match = (await accessiblePipelineArtifacts(exploreBuildContext(session, target, scope))).find(entry => entry.artifact.id === id);
    if (!match || !match.run.runFolder) return NextResponse.json({ error: "Output is unavailable in this scope." }, { status: 404 });
    const file = await resolveContainedPath(match.run.runFolder, match.artifact.path);
    const stat = await fs.stat(file);
    if (!stat.isFile()) return NextResponse.json({ error: "Output file is unavailable." }, { status: 404 });
    const mode = request.nextUrl.searchParams.get("mode");
    const { spec, output } = resolveTableSpec(match.run.pipelineId, match.artifact.outputId ?? "", undefined, match.artifact.metadata);
    if (mode === "table") {
      if (!spec || output?.result?.preview?.previewable === false) return NextResponse.json({ error: "This output has no table preview." }, { status: 400 });
      if (spec.format === "json" && stat.size > PREVIEW_BYTES) return NextResponse.json({ error: "This JSON table is too large to preview. Download it or add the table." }, { status: 413 });
      const handle = await fs.open(file, "r");
      let text: string;
      try {
        const buffer = Buffer.alloc(Math.min(stat.size, PREVIEW_BYTES));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        text = buffer.subarray(0, bytesRead).toString("utf8");
      } finally { await handle.close(); }
      if (stat.size > PREVIEW_BYTES) text = text.slice(0, text.lastIndexOf("\n"));
      const parsed = parsePipelineTable(text, spec);
      return NextResponse.json({ columns: parsed.columns.slice(0, 30).map(key => ({ key, label: spec.columns?.[key]?.label ?? spec.columnLabels?.[key] ?? key, unit: spec.columns?.[key]?.unit })),
        rows: parsed.rows.slice(0, 10).map(row => Object.fromEntries(parsed.columns.slice(0, 30).map(key => [key, typeof row[key] === "string" ? row[key].slice(0, 500) : row[key]]))),
        truncated: stat.size > PREVIEW_BYTES || parsed.rows.length > 10 || parsed.columns.length > 30 }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const view = outputFileView(file);
    const download = mode === "download";
    if (!download && (!view.contentType || output?.result?.preview?.previewable === false)) return NextResponse.json({ error: "Preview is not supported; download the original file." }, { status: 400 });
    const filename = encodeURIComponent(path.basename(file));
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: {
      "Content-Type": download ? "application/octet-stream" : view.contentType!,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${filename}`,
      "Content-Length": String(stat.size), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      // Reports run in an opaque origin, without access to SeqDesk or external resources.
      "Content-Security-Policy": "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'",
    } });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return NextResponse.json({ error: "The saved output file is missing." }, { status: 404 });
    return exploreErrorResponse(error);
  }
}
