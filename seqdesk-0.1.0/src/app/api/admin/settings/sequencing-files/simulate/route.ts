import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureWithinBase } from "@/lib/files";
import * as fs from "fs/promises";
import * as path from "path";
import { gzipSync } from "zlib";

const DEFAULT_EXTENSION = ".fastq.gz";
const DEFAULT_SAMPLE_COUNT = 3;

function buildFastqContent(sampleId: string): Buffer {
  const content = `@${sampleId}\nACGTACGTACGT\n+\nFFFFFFFFFFFF\n`;
  return Buffer.from(content, "utf-8");
}

// POST - create dummy sequencing files in the configured base path
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { count } = body as { count?: number };

    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { dataBasePath: true, extraSettings: true },
    });

    if (!settings?.dataBasePath) {
      return NextResponse.json(
        { error: "Data base path not configured" },
        { status: 400 }
      );
    }

    const resolvedBase = path.resolve(settings.dataBasePath);

    // Ensure base path is writable
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
        { error: "Data base path is not writable" },
        { status: 400 }
      );
    }

    let config: {
      allowedExtensions: string[];
      allowSingleEnd: boolean;
    } = {
      allowedExtensions: [DEFAULT_EXTENSION],
      allowSingleEnd: true,
    };

    if (settings.extraSettings) {
      try {
        const extra = JSON.parse(settings.extraSettings);
        if (extra.sequencingFiles) {
          config = {
            allowedExtensions:
              extra.sequencingFiles.allowedExtensions || config.allowedExtensions,
            allowSingleEnd:
              typeof extra.sequencingFiles.allowSingleEnd === "boolean"
                ? extra.sequencingFiles.allowSingleEnd
                : config.allowSingleEnd,
          };
        }
      } catch {
        // ignore parse errors
      }
    }

    const extension =
      config.allowedExtensions?.[0] || DEFAULT_EXTENSION;

    const sampleCount =
      typeof count === "number" && count > 0
        ? Math.min(count, 50)
        : DEFAULT_SAMPLE_COUNT;

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const folderName = `seqdesk-test-${timestamp}`;
    const targetDir = ensureWithinBase(resolvedBase, folderName);

    await fs.mkdir(targetDir, { recursive: true });

    let filesCreated = 0;
    let pairedCount = 0;
    let singleEndCount = 0;
    const samples: string[] = [];

    for (let i = 1; i <= sampleCount; i += 1) {
      const sampleId = `SEQDESK_TEST_${String(i).padStart(3, "0")}`;
      samples.push(sampleId);

      const read1Name = `${sampleId}_R1${extension}`;
      const read2Name = `${sampleId}_R2${extension}`;
      const isSingleEnd = config.allowSingleEnd && i === sampleCount;

      const baseBuffer = buildFastqContent(sampleId);
      const buffer = extension.endsWith(".gz")
        ? gzipSync(baseBuffer)
        : baseBuffer;

      await fs.writeFile(path.join(targetDir, read1Name), buffer);
      filesCreated += 1;

      if (!isSingleEnd) {
        await fs.writeFile(path.join(targetDir, read2Name), buffer);
        filesCreated += 1;
        pairedCount += 1;
      } else {
        singleEndCount += 1;
      }
    }

    return NextResponse.json({
      success: true,
      createdPath: targetDir,
      folderName,
      filesCreated,
      pairedCount,
      singleEndCount,
      samples,
      extension,
    });
  } catch (error) {
    console.error("[Simulate Files] Error:", error);
    return NextResponse.json(
      { error: "Failed to create test files" },
      { status: 500 }
    );
  }
}
