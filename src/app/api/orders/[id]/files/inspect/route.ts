import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import readline from "readline";
import { createGunzip } from "zlib";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSequencingFilesConfig } from "@/lib/files/sequencing-config";
import { hasAllowedExtension, safeJoin } from "@/lib/files/paths";
import { isDemoSession } from "@/lib/demo/server";

const DEFAULT_PREVIEW_LINES = 12;
const MAX_PREVIEW_LINES = 40;

const PREVIEWABLE_EXTENSIONS = new Set([
  "fastq",
  "fq",
  "fasta",
  "fa",
  "fna",
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
]);

type ReadCountSource = "database" | "computed" | "unsupported" | "error";

function parsePreviewLineCount(raw: string | null): number {
  if (!raw) return DEFAULT_PREVIEW_LINES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PREVIEW_LINES;
  return Math.min(parsed, MAX_PREVIEW_LINES);
}

function isGzipped(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".gz");
}

function stripGzipSuffix(filePath: string): string {
  return isGzipped(filePath) ? filePath.slice(0, -3) : filePath;
}

function isFastqLike(filePath: string): boolean {
  return /\.(fastq|fq)(\.gz)?$/i.test(filePath);
}

function isPreviewable(filePath: string): boolean {
  const ext = path.extname(stripGzipSuffix(filePath)).slice(1).toLowerCase();
  return PREVIEWABLE_EXTENSIONS.has(ext);
}

function createTextStream(absolutePath: string, gzipped: boolean): NodeJS.ReadableStream {
  const source = createReadStream(absolutePath);
  if (gzipped) {
    return source.pipe(createGunzip());
  }
  return source;
}

async function readPreviewLines(
  absolutePath: string,
  gzipped: boolean,
  maxLines: number
): Promise<{ lines: string[]; truncated: boolean }> {
  const stream = createTextStream(absolutePath, gzipped);
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  const lines: string[] = [];
  let truncated = false;

  try {
    for await (const line of rl) {
      if (lines.length < maxLines) {
        lines.push(line);
      } else {
        truncated = true;
        break;
      }
    }
  } finally {
    rl.close();
    if ("destroy" in stream && typeof stream.destroy === "function") {
      stream.destroy();
    }
  }

  return { lines, truncated };
}

async function countLines(absolutePath: string, gzipped: boolean): Promise<number> {
  const stream = createTextStream(absolutePath, gzipped);
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });
  let count = 0;

  try {
    for await (const line of rl) {
      if (line === undefined) {
        continue;
      }
      count += 1;
    }
  } finally {
    rl.close();
    if ("destroy" in stream && typeof stream.destroy === "function") {
      stream.destroy();
    }
  }

  return count;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (isDemoSession(session)) {
      return NextResponse.json(
        { error: "File inspection is disabled in the public demo." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const filePath = request.nextUrl.searchParams.get("path");
    const previewLines = parsePreviewLineCount(
      request.nextUrl.searchParams.get("lines")
    );

    if (!filePath) {
      return NextResponse.json(
        { error: "Missing path parameter" },
        { status: 400 }
      );
    }

    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

    const read = await db.read.findFirst({
      where: {
        OR: [{ file1: filePath }, { file2: filePath }],
        sample: {
          orderId: id,
          ...(isFacilityAdmin
            ? {}
            : {
                order: {
                  userId: session.user.id,
                  status: "COMPLETED",
                },
              }),
        },
      },
      select: {
        id: true,
        file1: true,
        file2: true,
        readCount1: true,
        readCount2: true,
      },
    });

    if (!read) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { dataBasePath, config } = await getSequencingFilesConfig();
    if (!dataBasePath) {
      return NextResponse.json(
        { error: "Data base path not configured" },
        { status: 400 }
      );
    }

    if (!hasAllowedExtension(filePath, config.allowedExtensions)) {
      return NextResponse.json(
        { error: "File type not allowed" },
        { status: 400 }
      );
    }

    let absolutePath: string;
    try {
      absolutePath = safeJoin(dataBasePath, filePath);
    } catch {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    let fileStat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      fileStat = await fs.stat(absolutePath);
    } catch {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if (!fileStat.isFile()) {
      return NextResponse.json({ error: "Not a file" }, { status: 400 });
    }

    const gzipped = isGzipped(filePath);
    const fastqLike = isFastqLike(filePath);
    const previewSupported = isPreviewable(filePath);
    const readField = read.file1 === filePath ? "file1" : "file2";

    let preview: {
      lines: string[];
      truncated: boolean;
      supported: boolean;
      error: string | null;
    } = {
      lines: [],
      truncated: false,
      supported: previewSupported,
      error: null,
    };

    if (previewSupported) {
      try {
        const result = await readPreviewLines(absolutePath, gzipped, previewLines);
        preview = {
          lines: result.lines,
          truncated: result.truncated,
          supported: true,
          error: null,
        };
      } catch (error) {
        preview = {
          lines: [],
          truncated: false,
          supported: true,
          error: error instanceof Error ? error.message : "Failed to read preview",
        };
      }
    }

    let readCount: number | null =
      readField === "file1" ? read.readCount1 : read.readCount2;
    let readCountSource: ReadCountSource = readCount !== null ? "database" : "unsupported";
    let readCountError: string | null = null;

    if (fastqLike && readCount === null) {
      try {
        const lineCount = await countLines(absolutePath, gzipped);
        readCount = Math.floor(lineCount / 4);
        readCountSource = "computed";

        await db.read.update({
          where: { id: read.id },
          data:
            readField === "file1"
              ? { readCount1: readCount }
              : { readCount2: readCount },
        });
      } catch (error) {
        readCountSource = "error";
        readCountError =
          error instanceof Error ? error.message : "Failed to calculate read count";
      }
    } else if (fastqLike && readCount !== null) {
      readCountSource = "database";
    }

    return NextResponse.json({
      filePath,
      fileName: path.basename(filePath),
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
      readCount,
      readCountSource,
      readCountError,
      preview,
    });
  } catch (error) {
    console.error("[Order File Inspect] Error:", error);
    return NextResponse.json(
      { error: "Failed to inspect file" },
      { status: 500 }
    );
  }
}
