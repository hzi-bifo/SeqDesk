import * as fs from "fs/promises";
import type { Dirent } from "fs";
import * as path from "path";

const DEFAULT_TEMPLATE_SUBDIR = "_simulation_templates/mag";

const TEMPLATE_NUMBERED_REGEX = /^template_(\d+)_(1|2)\.(fastq|fq)\.gz$/i;
const TEMPLATE_GENERIC_REGEX = /^(.+?)(?:_R([12])|_([12]))\.(fastq|fq)\.gz$/i;

export type SimulationMode = "auto" | "synthetic" | "template";

export interface SimulationTemplatePair {
  read1Path: string;
  read2Path: string;
  label: string;
}

export interface ResolveTemplateSourceOptions {
  dataBasePath: string;
  sequencingFilesConfig: Record<string, unknown>;
  extension: string;
}

export interface ResolvedTemplateSource {
  modeRequested: SimulationMode;
  modeUsed: "synthetic" | "template";
  templateDir: string | null;
  templatePairs: SimulationTemplatePair[];
  reason?: string;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseSimulationMode(value: unknown): SimulationMode {
  if (value === "synthetic" || value === "template" || value === "auto") {
    return value;
  }
  return "auto";
}

function resolveTemplateDir(
  dataBasePath: string,
  sequencingFilesConfig: Record<string, unknown>
): string {
  const configured = asTrimmedString(sequencingFilesConfig.simulationTemplateDir);
  if (!configured) {
    return path.resolve(dataBasePath, DEFAULT_TEMPLATE_SUBDIR);
  }
  return path.isAbsolute(configured)
    ? path.resolve(configured)
    : path.resolve(dataBasePath, configured);
}

interface PairAccumulator {
  read1Path?: string;
  read2Path?: string;
  label: string;
}

async function discoverTemplatePairs(templateDir: string): Promise<SimulationTemplatePair[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(templateDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

  const numberedMap = new Map<number, PairAccumulator>();
  for (const fileName of files) {
    const match = TEMPLATE_NUMBERED_REGEX.exec(fileName);
    if (!match) continue;
    const index = Number(match[1]);
    const mate = match[2];
    const absPath = path.join(templateDir, fileName);
    const existing = numberedMap.get(index) ?? { label: `template_${index}` };
    if (mate === "1") {
      existing.read1Path = absPath;
    } else {
      existing.read2Path = absPath;
    }
    numberedMap.set(index, existing);
  }

  const numberedPairs = Array.from(numberedMap.entries())
    .sort((a, b) => a[0] - b[0])
    .flatMap(([, pair]) =>
      pair.read1Path && pair.read2Path
        ? [{ read1Path: pair.read1Path, read2Path: pair.read2Path, label: pair.label }]
        : []
    );

  if (numberedPairs.length > 0) {
    return numberedPairs;
  }

  const genericMap = new Map<string, PairAccumulator>();
  for (const fileName of files) {
    const match = TEMPLATE_GENERIC_REGEX.exec(fileName);
    if (!match) continue;
    const key = match[1];
    const mate = match[2] ?? match[3];
    const absPath = path.join(templateDir, fileName);
    const existing = genericMap.get(key) ?? { label: key };
    if (mate === "1") {
      existing.read1Path = absPath;
    } else if (mate === "2") {
      existing.read2Path = absPath;
    }
    genericMap.set(key, existing);
  }

  return Array.from(genericMap.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .flatMap((pair) =>
      pair.read1Path && pair.read2Path
        ? [{ read1Path: pair.read1Path, read2Path: pair.read2Path, label: pair.label }]
        : []
    );
}

export async function resolveTemplateSource(
  options: ResolveTemplateSourceOptions
): Promise<ResolvedTemplateSource> {
  const modeRequested = parseSimulationMode(options.sequencingFilesConfig.simulationMode);
  if (modeRequested === "synthetic") {
    return {
      modeRequested,
      modeUsed: "synthetic",
      templateDir: null,
      templatePairs: [],
      reason: "Configured to synthetic mode",
    };
  }

  const templateDir = resolveTemplateDir(options.dataBasePath, options.sequencingFilesConfig);
  const extension = options.extension.toLowerCase();
  if (!extension.endsWith(".gz")) {
    if (modeRequested === "template") {
      throw new Error(
        `Template simulation requires gzip extensions, but configured extension is "${options.extension}".`
      );
    }
    return {
      modeRequested,
      modeUsed: "synthetic",
      templateDir,
      templatePairs: [],
      reason: "Configured extension is not gzipped",
    };
  }

  const templatePairs = await discoverTemplatePairs(templateDir);
  if (templatePairs.length === 0) {
    if (modeRequested === "template") {
      throw new Error(
        `No template FASTQ pairs found in "${templateDir}". Add files like "template_1_1.fastq.gz" and "template_1_2.fastq.gz".`
      );
    }
    return {
      modeRequested,
      modeUsed: "synthetic",
      templateDir,
      templatePairs: [],
      reason: "No template FASTQ pairs found",
    };
  }

  return {
    modeRequested,
    modeUsed: "template",
    templateDir,
    templatePairs,
  };
}

export function selectTemplatePair(
  templatePairs: SimulationTemplatePair[],
  sampleIndex: number
): SimulationTemplatePair {
  if (templatePairs.length === 0) {
    throw new Error("No template pairs available");
  }
  return templatePairs[sampleIndex % templatePairs.length];
}
