import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureWithinBase } from "@/lib/files";
import { buildSimulatedFastq } from "@/lib/simulation/fastq";
import {
  resolveTemplateSource,
  selectTemplatePair,
} from "@/lib/simulation/template-source";
import * as fs from "fs/promises";
import * as path from "path";
import { gzipSync } from "zlib";
import { isDemoSession } from "@/lib/demo/server";

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

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
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

  if (isDemoSession(session)) {
    return NextResponse.json(
      { error: "Simulated reads are disabled in the public demo." },
      { status: 403 }
    );
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
    let sequencingFilesConfig: Record<string, unknown> = {};
    if (settings.extraSettings) {
      try {
        const extra = asRecord(JSON.parse(settings.extraSettings) as unknown);
        sequencingFilesConfig = asRecord(extra.sequencingFiles);
        const extensionList = Array.isArray(sequencingFilesConfig.allowedExtensions)
          ? sequencingFilesConfig.allowedExtensions
          : Array.isArray(sequencingFilesConfig.extensions)
            ? sequencingFilesConfig.extensions
            : [];
        if (extensionList.length > 0) {
          const firstExtension = extensionList.find(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0
          );
          if (firstExtension) {
            extension = firstExtension;
          }
        }
      } catch {
        // ignore
      }
    }
    const templateSource = await resolveTemplateSource({
      dataBasePath: resolvedBase,
      sequencingFilesConfig,
      extension,
    });

    // Use a stable folder name (no timestamp) so re-runs overwrite in place
    const sanitizedTitle = study.title
      .replace(/[^a-zA-Z0-9]/g, "_")
      .substring(0, 30);
    const folderName = `study_${sanitizedTitle || "study"}`;
    const targetDir = ensureWithinBase(resolvedBase, folderName);

    await fs.mkdir(targetDir, { recursive: true });

    let filesCreated = 0;
    const createdFiles: Array<{
      sampleId: string;
      file1: string;
      file2: string | null;
    }> = [];

    // Create files for each sample
    for (let si = 0; si < study.samples.length; si++) {
      const sample = study.samples[si];
      const file1Name = `${sample.sampleId}_R1${extension}`;
      const file1AbsPath = path.join(targetDir, file1Name);
      // Relative path for database storage (relative to dataBasePath)
      const file1RelPath = path.join(folderName, file1Name);
      let file2AbsPath: string | null = null;
      let file2RelPath: string | null = null;

      if (templateSource.modeUsed === "template") {
        const templatePair = selectTemplatePair(templateSource.templatePairs, si);
        await fs.copyFile(templatePair.read1Path, file1AbsPath);
        filesCreated += 1;

        if (pairedEnd) {
          const file2Name = `${sample.sampleId}_R2${extension}`;
          file2AbsPath = path.join(targetDir, file2Name);
          file2RelPath = path.join(folderName, file2Name);
          await fs.copyFile(templatePair.read2Path, file2AbsPath);
          filesCreated += 1;
        }
      } else {
        const simulatedReads = buildSimulatedFastq({
          sampleId: sample.sampleId,
          sampleIndex: si,
          readCount: normalizedReadCount,
          readLength: normalizedReadLength,
          pairedEnd,
        });

        const buffer1 = extension.endsWith(".gz")
          ? gzipSync(simulatedReads.read1)
          : simulatedReads.read1;

        await fs.writeFile(file1AbsPath, buffer1);
        filesCreated += 1;

        if (pairedEnd) {
          const file2Name = `${sample.sampleId}_R2${extension}`;
          file2AbsPath = path.join(targetDir, file2Name);
          file2RelPath = path.join(folderName, file2Name);

          if (simulatedReads.read2) {
            const buffer2 = extension.endsWith(".gz")
              ? gzipSync(simulatedReads.read2)
              : simulatedReads.read2;
            await fs.writeFile(file2AbsPath, buffer2);
            filesCreated += 1;
          }
        }
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
      simulationMode: templateSource.modeUsed,
      templateDir: templateSource.templateDir,
      templatePairsAvailable: templateSource.templatePairs.length,
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
