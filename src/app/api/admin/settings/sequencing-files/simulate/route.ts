import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveDataBasePathFromStoredValue } from "@/lib/files/data-base-path";
import { ensureWithinBase } from "@/lib/files";
import { buildSimulatedFastq } from "@/lib/simulation/fastq";
import {
  resolveTemplateSource,
  selectTemplatePair,
} from "@/lib/simulation/template-source";
import * as fs from "fs/promises";
import * as path from "path";
import { gzipSync } from "zlib";

const DEFAULT_EXTENSION = ".fastq.gz";
const DEFAULT_SAMPLE_COUNT = 3;
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

// POST - create dummy sequencing files in the configured base path
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { count, readCount, readLength } = body as {
      count?: number;
      readCount?: number;
      readLength?: number;
    };

    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { dataBasePath: true, extraSettings: true },
    });

    const resolvedDataBasePath = resolveDataBasePathFromStoredValue(settings?.dataBasePath);

    if (!resolvedDataBasePath.dataBasePath) {
      return NextResponse.json(
        { error: "Data base path not configured" },
        { status: 400 }
      );
    }

    const resolvedBase = path.resolve(resolvedDataBasePath.dataBasePath);

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
      simulationMode: "auto" | "synthetic" | "template";
      simulationTemplateDir: string;
    } = {
      allowedExtensions: [DEFAULT_EXTENSION],
      allowSingleEnd: true,
      simulationMode: "auto",
      simulationTemplateDir: "",
    };

    if (settings?.extraSettings) {
      try {
        const extra = asRecord(JSON.parse(settings.extraSettings) as unknown);
        const sequencingFiles = asRecord(extra.sequencingFiles);
        if (Object.keys(sequencingFiles).length > 0) {
          const extensionList = Array.isArray(sequencingFiles.allowedExtensions)
            ? sequencingFiles.allowedExtensions
            : Array.isArray(sequencingFiles.extensions)
              ? sequencingFiles.extensions
              : [];
          const simulationMode = sequencingFiles.simulationMode;
          const simulationTemplateDir = sequencingFiles.simulationTemplateDir;
          config = {
            allowedExtensions: extensionList.length > 0
              ? extensionList.filter(
                  (value): value is string => typeof value === "string"
                )
              : config.allowedExtensions,
            allowSingleEnd: true,
            simulationMode:
              simulationMode === "template" ||
              simulationMode === "synthetic" ||
              simulationMode === "auto"
                ? simulationMode
                : config.simulationMode,
            simulationTemplateDir:
              typeof simulationTemplateDir === "string"
                ? simulationTemplateDir
                : config.simulationTemplateDir,
          };
        }
      } catch {
        // ignore parse errors
      }
    }

    const extension =
      config.allowedExtensions?.[0] || DEFAULT_EXTENSION;
    const templateSource = await resolveTemplateSource({
      dataBasePath: resolvedBase,
      sequencingFilesConfig: config,
      extension,
    });

    const sampleCount =
      typeof count === "number" && count > 0
        ? Math.min(count, 50)
        : DEFAULT_SAMPLE_COUNT;
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
      if (templateSource.modeUsed === "template") {
        const templatePair = selectTemplatePair(templateSource.templatePairs, i - 1);
        await fs.copyFile(templatePair.read1Path, path.join(targetDir, read1Name));
        filesCreated += 1;

        if (!isSingleEnd) {
          await fs.copyFile(templatePair.read2Path, path.join(targetDir, read2Name));
          filesCreated += 1;
          pairedCount += 1;
        } else {
          singleEndCount += 1;
        }
      } else {
        const simulatedReads = buildSimulatedFastq({
          sampleId,
          sampleIndex: i - 1,
          readCount: normalizedReadCount,
          readLength: normalizedReadLength,
          pairedEnd: !isSingleEnd,
        });
        const buffer1 = extension.endsWith(".gz")
          ? gzipSync(simulatedReads.read1)
          : simulatedReads.read1;

        await fs.writeFile(path.join(targetDir, read1Name), buffer1);
        filesCreated += 1;

        if (!isSingleEnd && simulatedReads.read2) {
          const buffer2 = extension.endsWith(".gz")
            ? gzipSync(simulatedReads.read2)
            : simulatedReads.read2;
          await fs.writeFile(path.join(targetDir, read2Name), buffer2);
          filesCreated += 1;
          pairedCount += 1;
        } else {
          singleEndCount += 1;
        }
      }
    }

    return NextResponse.json({
      success: true,
      createdPath: targetDir,
      folderName,
      filesCreated,
      pairedCount,
      singleEndCount,
      readCount: normalizedReadCount,
      readLength: normalizedReadLength,
      simulationMode: templateSource.modeUsed,
      templateDir: templateSource.templateDir,
      templatePairsAvailable: templateSource.templatePairs.length,
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
