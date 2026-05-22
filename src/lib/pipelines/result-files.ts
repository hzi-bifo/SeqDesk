import fs from "fs/promises";
import path from "path";

import { getPackage } from "@/lib/pipelines/package-loader";
import type { PackageOutputResultContract } from "@/lib/pipelines/package-contracts";

type ArtifactLike = {
  id: string;
  name: string | null;
  path: string;
  type: string;
  sampleId?: string | null;
  outputId?: string | null;
  size?: bigint | number | string | null;
};

export interface PipelineRunResultFile {
  id: string;
  name: string;
  path: string;
  type: string;
  outputId: string | null;
  source: "artifact" | "technical";
  size: number | null;
  previewable: boolean;
}

interface OutputMeta {
  order: number;
  name?: string;
  destination?: string;
  scope?: string;
  type?: string;
  result?: PackageOutputResultContract;
}

export const MAX_RUN_RESULT_FILES = 12;

const PREVIEWABLE_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".pdf",
  ".txt",
  ".tsv",
  ".csv",
  ".log",
  ".json",
]);

export function getPipelineRunTargetKey(run: {
  targetType?: string | null;
  studyId?: string | null;
  orderId?: string | null;
}): string | null {
  if (run.targetType === "order" && run.orderId) {
    return `order:${run.orderId}`;
  }
  if (run.studyId) {
    return `study:${run.studyId}`;
  }
  if (run.orderId) {
    return `order:${run.orderId}`;
  }
  return null;
}

function toNumberSize(value: ArtifactLike["size"]): number | null {
  if (value == null) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isPreviewable(filePath: string): boolean {
  return PREVIEWABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function prettifyId(value: string): string {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function fallbackName(filePath: string, outputId?: string | null): string {
  if (outputId) return prettifyId(outputId);
  return prettifyId(path.basename(filePath));
}

function buildOutputMeta(pipelineId: string): Map<string, OutputMeta> {
  const meta = new Map<string, OutputMeta>();
  const pkg = getPackage(pipelineId);
  const definitionOutputs = new Map(
    (pkg?.definition.outputs ?? []).map((output) => [output.id, output])
  );

  (pkg?.manifest.outputs ?? []).forEach((output, index) => {
    const definitionOutput = definitionOutputs.get(output.id);
    meta.set(output.id, {
      order: index,
      name: definitionOutput?.name,
      destination: output.destination,
      scope: output.scope,
      type: output.type,
      result: output.result,
    });
  });

  for (const [id, definitionOutput] of definitionOutputs) {
    if (!meta.has(id)) {
      meta.set(id, {
        order: meta.size,
        name: definitionOutput.name,
      });
    }
  }

  return meta;
}

function scoreResultFile(file: PipelineRunResultFile, meta?: OutputMeta): number {
  const ext = path.extname(file.path).toLowerCase();
  const haystack = `${file.outputId ?? ""} ${file.name} ${path.basename(file.path)}`.toLowerCase();
  let score = 0;

  if (meta?.destination === "study_report" || meta?.destination === "order_report") {
    score += 450;
  }
  if (meta?.result?.preview?.primary) score += 700;
  if (file.type === "report") score += 350;
  if (ext === ".html" || ext === ".htm") score += 320;
  if (haystack.includes("combined") && haystack.includes("report")) score += 220;
  if (haystack.includes("top50")) score += 80;
  if (ext === ".pdf") score += 180;
  if (ext === ".tsv" || ext === ".csv" || ext === ".txt" || ext === ".json") score += 90;
  if (haystack.includes("stats") || haystack.includes("profile")) score += 35;
  if (ext === ".log" || haystack.includes("log")) score -= 80;
  if (file.source === "technical") score -= 160;

  const outputOrder = meta?.order ?? 999;
  score += Math.max(0, 100 - outputOrder);

  return score;
}

function isUnderRunFolder(filePath: string, runFolder: string | null | undefined): boolean {
  if (!runFolder || !path.isAbsolute(filePath)) return false;
  const resolvedFile = path.resolve(filePath);
  const resolvedRunFolder = path.resolve(runFolder);
  return resolvedFile === resolvedRunFolder || resolvedFile.startsWith(`${resolvedRunFolder}${path.sep}`);
}

async function getExistingTechnicalReport(runFolder: string | null | undefined, runId: string) {
  if (!runFolder) return null;
  const reportPath = path.join(runFolder, "report.html");
  try {
    const stat = await fs.stat(reportPath);
    if (!stat.isFile()) return null;
    return {
      id: `technical-report:${runId}`,
      name: "Nextflow report",
      path: reportPath,
      type: "report",
      outputId: null,
      source: "technical" as const,
      size: stat.size,
      previewable: true,
    };
  } catch {
    return null;
  }
}

export interface PipelineRunResultFileSummary {
  files: PipelineRunResultFile[];
  omittedCount: number;
  omittedSampleFileCount: number;
}

export async function buildPipelineRunResultFileSummary({
  pipelineId,
  runId,
  runFolder,
  artifacts,
}: {
  pipelineId: string;
  runId: string;
  runFolder?: string | null;
  artifacts: ArtifactLike[];
}): Promise<PipelineRunResultFileSummary> {
  const outputMeta = buildOutputMeta(pipelineId);
  const filesByPath = new Map<string, PipelineRunResultFile>();
  let omittedSampleFileCount = 0;

  for (const artifact of artifacts) {
    const meta = artifact.outputId ? outputMeta.get(artifact.outputId) : undefined;
    if (artifact.sampleId || meta?.scope === "sample") {
      omittedSampleFileCount++;
      continue;
    }
    const name = artifact.name?.trim() || meta?.name || fallbackName(artifact.path, artifact.outputId);
    const previewEnabled = meta?.result?.preview?.previewable !== false;
    filesByPath.set(artifact.path, {
      id: artifact.id,
      name,
      path: artifact.path,
      type: artifact.type,
      outputId: artifact.outputId ?? null,
      source: "artifact",
      size: toNumberSize(artifact.size),
      previewable:
        previewEnabled && isPreviewable(artifact.path) && isUnderRunFolder(artifact.path, runFolder),
    });
  }

  const technicalReport = await getExistingTechnicalReport(runFolder, runId);
  if (technicalReport && !filesByPath.has(technicalReport.path)) {
    filesByPath.set(technicalReport.path, technicalReport);
  }

  const sorted = Array.from(filesByPath.values()).sort((a, b) => {
    const aMeta = a.outputId ? outputMeta.get(a.outputId) : undefined;
    const bMeta = b.outputId ? outputMeta.get(b.outputId) : undefined;
    const scoreDelta = scoreResultFile(b, bMeta) - scoreResultFile(a, aMeta);
    if (scoreDelta !== 0) return scoreDelta;
    return a.name.localeCompare(b.name);
  });

  const capped = sorted.slice(0, MAX_RUN_RESULT_FILES);

  return {
    files: capped,
    omittedCount: Math.max(0, sorted.length - capped.length),
    omittedSampleFileCount,
  };
}

export async function buildPipelineRunResultFiles(args: {
  pipelineId: string;
  runId: string;
  runFolder?: string | null;
  artifacts: ArtifactLike[];
}): Promise<PipelineRunResultFile[]> {
  return (await buildPipelineRunResultFileSummary(args)).files;
}

export function getPrimaryPipelineRunResultFile(
  files: PipelineRunResultFile[]
): PipelineRunResultFile | null {
  return files.find((file) => file.previewable) ?? files[0] ?? null;
}
