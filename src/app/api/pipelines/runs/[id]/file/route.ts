import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureWithinBase } from "@/lib/files";
import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { Readable } from "stream";

const MAX_PREVIEW_BYTES = 200 * 1024; // 200 KB
const TEXT_EXTENSIONS = new Set([
  "txt",
  "log",
  "out",
  "err",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "md",
  "dot",
]);

function isTextLikeFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".out") || lower.endsWith(".err")) return true;
  const ext = lower.split(".").pop();
  return !!ext && TEXT_EXTENSIONS.has(ext);
}

async function readTail(filePath: string, size: number): Promise<Buffer> {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const start = Math.max(0, stat.size - size);
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer;
  } finally {
    await handle.close();
  }
}

// GET - preview a pipeline run file (text-only)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const run = await db.pipelineRun.findUnique({
      where: { id },
      select: {
        runFolder: true,
        study: { select: { userId: true } },
        order: { select: { userId: true } },
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (
      session.user.role !== "FACILITY_ADMIN" &&
      run.study?.userId !== session.user.id &&
      run.order?.userId !== session.user.id
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!run.runFolder) {
      return NextResponse.json(
        { error: "Run folder not set" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const targetPath = searchParams.get("path");
    const downloadRequested =
      searchParams.get("download") === "1" ||
      searchParams.get("mode") === "download";
    if (!targetPath) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    let absolutePath: string;
    try {
      absolutePath = ensureWithinBase(run.runFolder, targetPath);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid path" },
        { status: 400 }
      );
    }

    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      return NextResponse.json({ error: "Not a file" }, { status: 400 });
    }

    if (downloadRequested) {
      const fileName = path.basename(absolutePath);
      const stream = createReadStream(absolutePath);
      const webStream = Readable.toWeb(stream) as ReadableStream;
      return new Response(webStream, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Content-Length": String(stat.size),
        },
      });
    }

    if (!isTextLikeFile(targetPath)) {
      return NextResponse.json(
        { error: "Preview supported for text files only" },
        { status: 400 }
      );
    }

    let content = "";
    let truncated = false;
    if (stat.size > MAX_PREVIEW_BYTES) {
      truncated = true;
      const buffer = await readTail(absolutePath, MAX_PREVIEW_BYTES);
      content = buffer.toString("utf-8");
    } else {
      content = await fs.readFile(absolutePath, "utf-8");
    }

    return NextResponse.json({
      content,
      truncated,
      size: stat.size,
    });
  } catch (error) {
    console.error("[Run File Preview] Error:", error);
    return NextResponse.json(
      { error: "Failed to load file" },
      { status: 500 }
    );
  }
}
