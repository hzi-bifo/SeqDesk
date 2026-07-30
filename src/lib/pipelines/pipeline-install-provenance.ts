import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import {
  getPipelinesDir,
  resolvePipelinePackageDir,
} from "./pipeline-paths";
import type { PipelineSourceKind } from "./store-sources";

export const PIPELINE_INSTALL_PROVENANCE_FILE = ".seqdesk-install.json";
const MAX_PROVENANCE_BYTES = 16 * 1024;

export interface PipelineInstallProvenance {
  schemaVersion: 1;
  pipelineId: string;
  version: string;
  sourceId: string;
  sourceKind: PipelineSourceKind;
  installedAt: string;
}

function isPipelineSourceKind(value: unknown): value is PipelineSourceKind {
  return (
    value === "registry" ||
    value === "privateRegistry" ||
    value === "github"
  );
}

function parsePipelineInstallProvenance(
  value: unknown,
  pipelineId: string
): PipelineInstallProvenance | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<PipelineInstallProvenance>;
  if (
    candidate.schemaVersion !== 1 ||
    candidate.pipelineId !== pipelineId ||
    typeof candidate.version !== "string" ||
    candidate.version.trim().length === 0 ||
    typeof candidate.sourceId !== "string" ||
    candidate.sourceId.trim().length === 0 ||
    !isPipelineSourceKind(candidate.sourceKind) ||
    typeof candidate.installedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.installedAt))
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    pipelineId,
    version: candidate.version.trim(),
    sourceId: candidate.sourceId.trim(),
    sourceKind: candidate.sourceKind,
    installedAt: candidate.installedAt,
  };
}

export async function readPipelineInstallProvenance(
  pipelineId: string,
  pipelinesDir = getPipelinesDir()
): Promise<PipelineInstallProvenance | null> {
  const packageDir = resolvePipelinePackageDir(pipelinesDir, pipelineId);
  const provenancePath = path.join(
    packageDir,
    PIPELINE_INSTALL_PROVENANCE_FILE
  );

  try {
    const stats = await fs.lstat(provenancePath);
    if (
      stats.isSymbolicLink() ||
      !stats.isFile() ||
      stats.size > MAX_PROVENANCE_BYTES
    ) {
      return null;
    }
    const raw = await fs.readFile(provenancePath, "utf8");
    return parsePipelineInstallProvenance(JSON.parse(raw), pipelineId);
  } catch {
    return null;
  }
}

export async function writePipelineInstallProvenance(
  provenance: Omit<PipelineInstallProvenance, "schemaVersion" | "installedAt"> & {
    installedAt?: string;
  },
  pipelinesDir = getPipelinesDir()
): Promise<PipelineInstallProvenance> {
  const packageDir = resolvePipelinePackageDir(
    pipelinesDir,
    provenance.pipelineId
  );
  return writePipelineInstallProvenanceToPackageDir(
    provenance,
    packageDir
  );
}

export async function writePipelineInstallProvenanceToPackageDir(
  provenance: Omit<PipelineInstallProvenance, "schemaVersion" | "installedAt"> & {
    installedAt?: string;
  },
  packageDir: string
): Promise<PipelineInstallProvenance> {
  const packageStats = await fs.lstat(packageDir);
  if (packageStats.isSymbolicLink() || !packageStats.isDirectory()) {
    throw new Error(
      `Cannot record install provenance for unsafe package directory: ${packageDir}`
    );
  }

  const value: PipelineInstallProvenance = {
    schemaVersion: 1,
    pipelineId: provenance.pipelineId,
    version: provenance.version.trim() || "unknown",
    sourceId: provenance.sourceId.trim(),
    sourceKind: provenance.sourceKind,
    installedAt: provenance.installedAt || new Date().toISOString(),
  };
  const parsed = parsePipelineInstallProvenance(value, provenance.pipelineId);
  if (!parsed) {
    throw new Error("Invalid pipeline install provenance.");
  }

  const provenancePath = path.join(
    packageDir,
    PIPELINE_INSTALL_PROVENANCE_FILE
  );
  const tempPath = path.join(
    packageDir,
    `${PIPELINE_INSTALL_PROVENANCE_FILE}.tmp-${randomUUID()}`
  );
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await fs.rename(tempPath, provenancePath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
  return parsed;
}
