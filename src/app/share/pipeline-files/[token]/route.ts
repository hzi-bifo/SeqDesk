import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveContainedPath } from "@/lib/explore/storage";
import { integrationConfig } from "@/lib/integration/config";
import { PIPELINE_FILE_CSP, readPipelineFileToken, withStorageShim } from "@/lib/pipelines/pipeline-file-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8", ".csv": "text/csv; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png",
  ".svg": "image/svg+xml", ".pdf": "application/pdf" };

const text = (body: string, status: number) => new NextResponse(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });

/**
 * One pipeline output file behind a short-lived signed link (see pipeline-file-link.ts): served inline under a
 * sandbox CSP so a report's own scripts run in an opaque origin, never with this server's rights.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const config = integrationConfig();
  if (!config) return text("Not found", 404);
  const { token } = await context.params;
  const link = readPipelineFileToken(config.secret, token);
  if (!link) return text("This link has expired. Open the report again from the pipeline card.", 410);
  const artifact = await db.pipelineArtifact.findFirst({ where: { id: link.artifactId, pipelineRunId: link.runId, pipelineRun: { status: "completed" } },
    select: { path: true, name: true, pipelineRun: { select: { runFolder: true } } } });
  if (!artifact?.pipelineRun?.runFolder) return text("Not found", 404);
  const file = await resolveContainedPath(artifact.pipelineRun.runFolder, artifact.path).catch(() => null);
  if (!file) return text("Not found", 404);
  const bytes = await fs.readFile(file).catch(() => null);
  if (!bytes) return text("The file is gone from the run folder.", 404);
  const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const body = type.startsWith("text/html") ? withStorageShim(bytes.toString("utf8")) : new Uint8Array(bytes);
  return new NextResponse(body, { status: 200, headers: {
    "Content-Type": type, "Content-Security-Policy": PIPELINE_FILE_CSP, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer", "Content-Disposition": `inline; filename="${(artifact.name ?? path.basename(file)).replace(/["\\\r\n]/g, "_")}"`,
  } });
}
