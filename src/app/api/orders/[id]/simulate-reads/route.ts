import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureWithinBase } from "@/lib/files";
import * as fs from "fs/promises";
import * as path from "path";
import { gzipSync } from "zlib";

const DEFAULT_EXTENSION = ".fastq.gz";
const DEFAULT_READ_COUNT = 1000;
const DEFAULT_READ_LENGTH = 150;
const MAX_READ_COUNT = 50_000;
const MAX_READ_LENGTH = 300;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const rounded = Math.floor(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

// Simple seeded pseudo-random number generator (xorshift32)
function createRng(seed: number) {
  let s = seed | 1; // avoid zero
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000; // 0..1
  };
}

const BASES = "ACGT";

// GC content varies per "organism" to create diversity across samples
const GC_PROFILES = [0.45, 0.55, 0.65, 0.35, 0.50, 0.60, 0.40, 0.70];

function buildSequence(length: number, rng: () => number, gcContent: number): string {
  const chars: string[] = new Array(length);
  for (let i = 0; i < length; i++) {
    const r = rng();
    if (r < gcContent / 2) {
      chars[i] = "G";
    } else if (r < gcContent) {
      chars[i] = "C";
    } else if (r < gcContent + (1 - gcContent) / 2) {
      chars[i] = "A";
    } else {
      chars[i] = "T";
    }
  }
  return chars.join("");
}

// Illumina-like quality scores: high in middle, lower at ends
function buildQuality(length: number, rng: () => number): string {
  const chars: string[] = new Array(length);
  // Phred+33 range: '!' (0) to 'J' (41)
  for (let i = 0; i < length; i++) {
    // Position-dependent base quality
    let meanQ: number;
    if (i < 5) {
      meanQ = 25 + i * 2; // ramp up at start
    } else if (i > length - 10) {
      meanQ = Math.max(15, 35 - (i - (length - 10)) * 2); // drop at end
    } else {
      meanQ = 35; // stable mid-read
    }
    // Add some noise
    const q = Math.max(2, Math.min(41, Math.round(meanQ + (rng() - 0.5) * 10)));
    chars[i] = String.fromCharCode(33 + q);
  }
  return chars.join("");
}

function buildFastqContent(
  sampleId: string,
  readCount: number,
  readLength: number,
  readOffset: number,
  sampleIndex: number
): Buffer {
  const lines: string[] = [];
  const rng = createRng(sampleIndex * 1_000_000 + readOffset * 10_000 + 42);
  // Each sample gets a mix of 2-3 "organisms" with different GC content
  const gc1 = GC_PROFILES[sampleIndex % GC_PROFILES.length];
  const gc2 = GC_PROFILES[(sampleIndex + 3) % GC_PROFILES.length];

  for (let i = 0; i < readCount; i += 1) {
    const readNum = readOffset + i + 1;
    // 60% from organism 1, 40% from organism 2
    const gc = rng() < 0.6 ? gc1 : gc2;
    const sequence = buildSequence(readLength, rng, gc);
    const quality = buildQuality(readLength, rng);
    // Illumina-style header: instrument:run:flowcell:lane:tile:x:y
    lines.push(
      `@SIM:1:FC1:1:1:${readNum}:${sampleIndex + 1} ${readOffset === 0 ? 1 : 2}:N:0:${sampleId}`,
      sequence,
      "+",
      quality
    );
  }

  return Buffer.from(`${lines.join("\n")}\n`, "utf-8");
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // File may already be removed or never existed
  }
}

// POST - create dummy sequencing files for an order's samples
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id: orderId } = await params;
    const body = await request.json().catch(() => ({}));
    const {
      pairedEnd = true,
      createRecords = true,
      readCount,
      readLength,
    } = body as {
      pairedEnd?: boolean;
      createRecords?: boolean;
      readCount?: number;
      readLength?: number;
    };
    const normalizedReadCount = clampInt(
      readCount,
      DEFAULT_READ_COUNT,
      2,
      MAX_READ_COUNT
    );
    const normalizedReadLength = clampInt(
      readLength,
      DEFAULT_READ_LENGTH,
      25,
      MAX_READ_LENGTH
    );

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        samples: {
          select: {
            id: true,
            sampleId: true,
            reads: { select: { id: true, file1: true, file2: true } },
          },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (order.samples.length === 0) {
      return NextResponse.json(
        { error: "Order has no samples" },
        { status: 400 }
      );
    }

    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { dataBasePath: true, extraSettings: true },
    });

    if (!settings?.dataBasePath) {
      return NextResponse.json(
        { error: "Data base path not configured. Configure it in Admin > Settings." },
        { status: 400 }
      );
    }

    const resolvedBase = path.resolve(settings.dataBasePath);

    try {
      const stats = await fs.stat(resolvedBase);
      if (!stats.isDirectory()) {
        return NextResponse.json(
          { error: "Data base path is not a directory" },
          { status: 400 }
        );
      }
      await fs.access(resolvedBase, fs.constants.W_OK);
    } catch {
      return NextResponse.json(
        { error: "Data base path does not exist or is not writable" },
        { status: 400 }
      );
    }

    let extension = DEFAULT_EXTENSION;
    if (settings.extraSettings) {
      try {
        const extra = JSON.parse(settings.extraSettings);
        if (extra.sequencingFiles?.allowedExtensions?.[0]) {
          extension = extra.sequencingFiles.allowedExtensions[0];
        }
      } catch {
        // ignore
      }
    }

    // Use a stable folder name (no timestamp) so re-runs overwrite in place
    const rawName = order.name || order.id;
    const sanitizedName = rawName
      .replace(/[^a-zA-Z0-9]/g, "_")
      .substring(0, 30);
    const folderName = `order_${sanitizedName || "order"}`;
    const targetDir = ensureWithinBase(resolvedBase, folderName);

    await fs.mkdir(targetDir, { recursive: true });

    // Delete existing Read records and their physical files for each sample
    let oldFilesRemoved = 0;
    for (const sample of order.samples) {
      for (const read of sample.reads) {
        // Remove old physical files
        if (read.file1) {
          const absPath = path.resolve(resolvedBase, read.file1);
          await safeUnlink(absPath);
          oldFilesRemoved++;
        }
        if (read.file2) {
          const absPath = path.resolve(resolvedBase, read.file2);
          await safeUnlink(absPath);
          oldFilesRemoved++;
        }
        // Delete old Read record
        await db.read.delete({ where: { id: read.id } });
      }
    }

    let filesCreated = 0;
    const createdFiles: Array<{
      sampleId: string;
      file1: string;
      file1Size: number;
      file2: string | null;
      file2Size: number | null;
    }> = [];

    for (let si = 0; si < order.samples.length; si++) {
      const sample = order.samples[si];
      const file1Name = `${sample.sampleId}_R1${extension}`;
      const file1AbsPath = path.join(targetDir, file1Name);
      const file1RelPath = path.join(folderName, file1Name);

      const buffer1 = extension.endsWith(".gz")
        ? gzipSync(
            buildFastqContent(
              sample.sampleId,
              normalizedReadCount,
              normalizedReadLength,
              0,
              si
            )
          )
        : buildFastqContent(
            sample.sampleId,
            normalizedReadCount,
            normalizedReadLength,
            0,
            si
          );

      await fs.writeFile(file1AbsPath, buffer1);
      filesCreated += 1;

      let file2AbsPath: string | null = null;
      let file2RelPath: string | null = null;
      let buffer2Size: number | null = null;
      if (pairedEnd) {
        const file2Name = `${sample.sampleId}_R2${extension}`;
        file2AbsPath = path.join(targetDir, file2Name);
        file2RelPath = path.join(folderName, file2Name);

        const buffer2 = extension.endsWith(".gz")
          ? gzipSync(
              buildFastqContent(
                sample.sampleId,
                normalizedReadCount,
                normalizedReadLength,
                normalizedReadCount,
                si
              )
            )
          : buildFastqContent(
              sample.sampleId,
              normalizedReadCount,
              normalizedReadLength,
              normalizedReadCount,
              si
            );

        await fs.writeFile(file2AbsPath, buffer2);
        buffer2Size = buffer2.length;
        filesCreated += 1;
      }

      createdFiles.push({
        sampleId: sample.sampleId,
        file1: file1AbsPath,
        file1Size: buffer1.length,
        file2: file2AbsPath,
        file2Size: buffer2Size,
      });

      if (createRecords) {
        await db.read.create({
          data: {
            sampleId: sample.id,
            file1: file1RelPath,
            file2: file2RelPath,
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      createdPath: targetDir,
      folderName,
      filesCreated,
      oldFilesRemoved,
      samplesProcessed: order.samples.length,
      pairedEnd,
      recordsCreated: createRecords,
      readCount: normalizedReadCount,
      readLength: normalizedReadLength,
      files: createdFiles,
    });
  } catch (error) {
    console.error("[Simulate Reads] Error:", error);
    return NextResponse.json(
      { error: "Failed to create simulated read files" },
      { status: 500 }
    );
  }
}
