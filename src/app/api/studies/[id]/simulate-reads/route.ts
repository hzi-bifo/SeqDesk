import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureWithinBase } from "@/lib/files";
import * as fs from "fs/promises";
import * as path from "path";
import { gzipSync } from "zlib";

const DEFAULT_EXTENSION = ".fastq.gz";
const DEFAULT_READ_COUNT = 50;
const DEFAULT_READ_LENGTH = 150;
const MAX_READ_COUNT = 1000;
const MAX_READ_LENGTH = 1000;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const rounded = Math.floor(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function buildSequence(length: number, seed: number): string {
  const pattern = "ACGT";
  const shift = seed % pattern.length;
  const rotated = pattern.slice(shift) + pattern.slice(0, shift);
  return rotated.repeat(Math.ceil(length / rotated.length)).slice(0, length);
}

function buildFastqContent(
  sampleId: string,
  readCount: number,
  readLength: number,
  readOffset: number
): Buffer {
  const lines: string[] = [];
  const quality = "I".repeat(readLength);

  for (let i = 0; i < readCount; i += 1) {
    const readNum = readOffset + i + 1;
    const sequence = buildSequence(readLength, readNum);
    lines.push(
      `@${sampleId}_read${readNum}`,
      sequence,
      "+",
      quality
    );
  }

  return Buffer.from(`${lines.join("\n")}\n`, "utf-8");
}

// POST - create dummy sequencing files for a study's samples
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id: studyId } = await params;
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

    // Get the study with samples
    const study = await db.study.findUnique({
      where: { id: studyId },
      include: {
        samples: {
          select: {
            id: true,
            sampleId: true,
            reads: { select: { id: true } },
          },
        },
      },
    });

    if (!study) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    if (study.samples.length === 0) {
      return NextResponse.json(
        { error: "Study has no samples" },
        { status: 400 }
      );
    }

    // Get data base path from settings
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

    // Check if base path exists and is writable
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

    // Get extension from config
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

    // Create folder for this study's simulated reads
    const sanitizedTitle = study.title
      .replace(/[^a-zA-Z0-9]/g, "_")
      .substring(0, 30);
    const timestamp = Date.now();
    const folderName = `study_${sanitizedTitle}_${timestamp}`;
    const targetDir = ensureWithinBase(resolvedBase, folderName);

    await fs.mkdir(targetDir, { recursive: true });

    let filesCreated = 0;
    const createdFiles: Array<{
      sampleId: string;
      file1: string;
      file2: string | null;
    }> = [];

    // Create files for each sample
    for (const sample of study.samples) {
      const file1Name = `${sample.sampleId}_R1${extension}`;
      const file1AbsPath = path.join(targetDir, file1Name);
      // Relative path for database storage (relative to dataBasePath)
      const file1RelPath = path.join(folderName, file1Name);

      const buffer1 = extension.endsWith(".gz")
        ? gzipSync(
            buildFastqContent(
              sample.sampleId,
              normalizedReadCount,
              normalizedReadLength,
              0
            )
          )
        : buildFastqContent(
            sample.sampleId,
            normalizedReadCount,
            normalizedReadLength,
            0
          );

      await fs.writeFile(file1AbsPath, buffer1);
      filesCreated += 1;

      let file2AbsPath: string | null = null;
      let file2RelPath: string | null = null;
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
                normalizedReadCount
              )
            )
          : buildFastqContent(
              sample.sampleId,
              normalizedReadCount,
              normalizedReadLength,
              normalizedReadCount
            );

        await fs.writeFile(file2AbsPath, buffer2);
        filesCreated += 1;
      }

      createdFiles.push({
        sampleId: sample.sampleId,
        file1: file1AbsPath,
        file2: file2AbsPath,
      });

      // Create Read records if requested (use relative paths for DB)
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
      samplesProcessed: study.samples.length,
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
