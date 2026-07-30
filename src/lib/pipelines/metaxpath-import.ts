import fs from "fs/promises";
import path from "path";
import type { PackageManifest } from "./package-loader";
import {
  installPackageDirectory,
  type PackageInstallOptions,
} from "./package-install";
import {
  getPipelinesDir,
  isLocalPipelineReference,
  resolvePathWithinDirectory,
} from "./pipeline-paths";
import {
  METAXPATH_PIPELINE_ID,
  METAXPATH_REPOSITORY,
} from "./metaxpath-config";
import {
  writePipelineInstallProvenanceToPackageDir,
} from "./pipeline-install-provenance";
import type { PipelineSourceKind } from "./store-sources";

export {
  DEFAULT_METAXPATH_REF,
  METAXPATH_DESCRIPTOR_RELATIVE_PATH,
  METAXPATH_PIPELINE_ID,
  METAXPATH_REPOSITORY,
  resolveMetaxPathRef,
} from "./metaxpath-config";

export const METAXPATH_REPO_HTTPS = `https://github.com/${METAXPATH_REPOSITORY}.git`;

export const REQUIRED_DESCRIPTOR_FILES = [
  "manifest.json",
  "definition.json",
  "registry.json",
  "samplesheet.yaml",
] as const;

const EXCLUDED_WORKFLOW_ROOT_ENTRIES = new Set([
  ".git",
  ".seqdesk",
  ".claude",
  "agents.md",
  "claude.md",
]);

export interface CloneFailureClassification {
  status: number;
  error: string;
}

export interface DescriptorValidationResult {
  valid: boolean;
  errors: string[];
  manifest?: PackageManifest;
}

export interface GitHubPipelineInstallOptions {
  pipelineId: string;
  cloneDir: string;
  repo: string;
  ref: string;
  commit?: string;
  descriptorPath?: string;
  includeWorkflow?: boolean;
  replaceExisting?: boolean;
  beforeLockedInstall?: PackageInstallOptions["beforeLockedInstall"];
  installProvenance?: {
    sourceId: string;
    sourceKind: PipelineSourceKind;
  };
}

export class PipelineDescriptorValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineDescriptorValidationError";
  }
}

function normalizeErrorText(value: string): string {
  return value.toLowerCase();
}

function isAuthFailure(text: string): boolean {
  return (
    text.includes("authentication failed") ||
    text.includes("authorization failed") ||
    text.includes("invalid username or password") ||
    text.includes("could not read username") ||
    text.includes("repository not found")
  );
}

function isMissingRefFailure(text: string): boolean {
  return text.includes("remote branch") && text.includes("not found");
}

export function classifyCloneFailure(details: string): CloneFailureClassification {
  const normalized = normalizeErrorText(details);
  if (isAuthFailure(normalized)) {
    return {
      status: 401,
      error: "GitHub authentication failed. Verify the token and repository access.",
    };
  }
  if (isMissingRefFailure(normalized)) {
    return {
      status: 400,
      error: "Requested Git reference was not found in the GitHub repository.",
    };
  }
  return {
    status: 500,
    error: "Failed to clone GitHub repository.",
  };
}

export function isValidGitRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("-")) return false;
  if (trimmed.includes("..")) return false;
  return /^[A-Za-z0-9._/-]+$/.test(trimmed);
}

export function shouldCopyWorkflowEntry(entryName: string): boolean {
  if (!entryName) return false;
  if (entryName.startsWith(".")) return false;
  return !EXCLUDED_WORKFLOW_ROOT_ENTRIES.has(entryName.toLowerCase());
}

function getDescriptorPath(pipelineId: string, descriptorPath?: string): string {
  const trimmed = descriptorPath?.trim();
  return trimmed && trimmed.length > 0
    ? trimmed
    : `.seqdesk/pipelines/${pipelineId}`;
}

function shouldRequireWorkflowSnapshot(
  manifest: PackageManifest,
  includeWorkflow?: boolean
): boolean {
  const pipelineReference = manifest.execution?.pipeline;
  if (
    typeof pipelineReference !== "string" ||
    !isLocalPipelineReference(pipelineReference)
  ) {
    return false;
  }
  if (typeof includeWorkflow === "boolean") return includeWorkflow;
  return true;
}

interface DeclaredDescriptorFile {
  label: string;
  relativePath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectDeclaredDescriptorFiles(
  manifest: PackageManifest
): { files: DeclaredDescriptorFile[]; errors: string[] } {
  const files: DeclaredDescriptorFile[] = [
    { label: "manifest.json", relativePath: "manifest.json" },
  ];
  const errors: string[] = [];
  const manifestFiles = (manifest as { files?: unknown }).files;
  if (!isRecord(manifestFiles)) {
    errors.push("manifest.json files must be an object.");
    return { files, errors };
  }

  const addFile = (label: string, value: unknown, required = false) => {
    if (value === undefined && !required) return;
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push(`manifest.json ${label} must be a non-empty string.`);
      return;
    }
    files.push({ label, relativePath: value });
  };

  addFile("files.definition", manifestFiles.definition, true);
  addFile("files.registry", manifestFiles.registry, true);
  addFile("files.samplesheet", manifestFiles.samplesheet, true);
  addFile("files.readme", manifestFiles.readme);

  if (manifestFiles.parsers !== undefined) {
    if (!Array.isArray(manifestFiles.parsers)) {
      errors.push("manifest.json files.parsers must be an array.");
    } else {
      for (const [index, parserPath] of manifestFiles.parsers.entries()) {
        addFile(`files.parsers[${index}]`, parserPath, true);
      }
    }
  }

  if (manifestFiles.scripts !== undefined) {
    if (!isRecord(manifestFiles.scripts)) {
      errors.push("manifest.json files.scripts must be an object.");
    } else {
      addFile(
        "files.scripts.samplesheet",
        manifestFiles.scripts.samplesheet
      );
      addFile(
        "files.scripts.discoverOutputs",
        manifestFiles.scripts.discoverOutputs
      );
    }
  }

  const seen = new Set<string>();
  return {
    files: files.filter(({ relativePath }) => {
      if (seen.has(relativePath)) return false;
      seen.add(relativePath);
      return true;
    }),
    errors,
  };
}

export async function validatePipelineDescriptorDir(
  descriptorDir: string,
  pipelineId: string
): Promise<DescriptorValidationResult> {
  const errors: string[] = [];

  try {
    const stat = await fs.stat(descriptorDir);
    if (!stat.isDirectory()) {
      errors.push(`Descriptor path is not a directory: ${descriptorDir}`);
      return { valid: false, errors };
    }
  } catch {
    errors.push(`Descriptor directory not found: ${descriptorDir}`);
    return { valid: false, errors };
  }

  const manifestPath = path.join(descriptorDir, "manifest.json");
  let manifest: PackageManifest | undefined;
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      errors.push("manifest.json must contain a JSON object.");
      return { valid: false, errors };
    }
    manifest = parsed as unknown as PackageManifest;
  } catch {
    errors.push("manifest.json is not valid JSON.");
    return { valid: false, errors };
  }

  const declaredFiles = collectDeclaredDescriptorFiles(manifest);
  errors.push(...declaredFiles.errors);
  for (const { label, relativePath } of declaredFiles.files) {
    let filePath: string;
    try {
      filePath = resolvePathWithinDirectory(
        descriptorDir,
        relativePath,
        label
      );
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : `Invalid ${label}.`
      );
      continue;
    }

    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        errors.push(`Descriptor file is not a regular file: ${relativePath}`);
      }
    } catch {
      errors.push(`Missing descriptor file: ${relativePath}`);
    }
  }

  if (manifest.package?.id !== pipelineId) {
    errors.push(
      `manifest.json package.id must be "${pipelineId}" (received "${manifest.package?.id ?? "missing"}").`
    );
  }

  if (pipelineId === METAXPATH_PIPELINE_ID) {
    if (manifest.execution?.pipeline !== "./workflow") {
      errors.push('manifest.json execution.pipeline must be "./workflow".');
    }

    if (manifest.execution?.type !== "nextflow") {
      errors.push('manifest.json execution.type must be "nextflow".');
    }

    if (
      typeof manifest.execution?.version !== "string" ||
      manifest.execution.version.trim().length === 0
    ) {
      errors.push("manifest.json execution.version must be a non-empty string.");
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, manifest };
  }

  return { valid: true, errors, manifest };
}

export async function validateMetaxPathDescriptorDir(
  descriptorDir: string
): Promise<DescriptorValidationResult> {
  return validatePipelineDescriptorDir(descriptorDir, METAXPATH_PIPELINE_ID);
}

export async function installGitHubPipelineSnapshot(
  options: GitHubPipelineInstallOptions
): Promise<{ action: "install" | "update"; syncedAt: string; manifest?: PackageManifest }> {
  const pipelinesDir = getPipelinesDir();
  const descriptorPath = getDescriptorPath(options.pipelineId, options.descriptorPath);
  const descriptorDir = resolvePathWithinDirectory(
    options.cloneDir,
    descriptorPath,
    "descriptor path",
    { allowBase: true }
  );
  const validation = await validatePipelineDescriptorDir(
    descriptorDir,
    options.pipelineId
  );
  if (!validation.valid) {
    throw new PipelineDescriptorValidationError(validation.errors.join(" "));
  }

  const manifest = validation.manifest;
  if (!manifest) {
    throw new PipelineDescriptorValidationError(
      "Validated descriptor did not contain a manifest."
    );
  }
  const declaredFiles = collectDeclaredDescriptorFiles(manifest);
  if (declaredFiles.errors.length > 0) {
    throw new PipelineDescriptorValidationError(
      declaredFiles.errors.join(" ")
    );
  }
  const syncedAt = new Date().toISOString();
  const action = await installPackageDirectory(
    pipelinesDir,
    options.pipelineId,
    async (stageDir) => {
      if (shouldRequireWorkflowSnapshot(manifest, options.includeWorkflow)) {
        const fileEntrypoint = manifest.execution.pipeline
          .toLowerCase()
          .endsWith(".nf");
        const workflowRoot = fileEntrypoint
          ? stageDir
          : resolvePathWithinDirectory(
              stageDir,
              manifest.execution.pipeline,
              "execution.pipeline",
              { allowBase: true }
            );
        await fs.mkdir(workflowRoot, { recursive: true });
        const rootEntries = await fs.readdir(options.cloneDir, { withFileTypes: true });
        for (const entry of rootEntries) {
          if (!shouldCopyWorkflowEntry(entry.name)) continue;
          const sourcePath = resolvePathWithinDirectory(
            options.cloneDir,
            entry.name,
            "workflow source"
          );
          const destinationPath = resolvePathWithinDirectory(
            workflowRoot,
            entry.name,
            "workflow destination"
          );
          await fs.cp(sourcePath, destinationPath, { recursive: true });
        }
      }

      for (const { label, relativePath } of declaredFiles.files) {
        const sourcePath = resolvePathWithinDirectory(
          descriptorDir,
          relativePath,
          label
        );
        const destinationPath = resolvePathWithinDirectory(
          stageDir,
          relativePath,
          label
        );
        await fs.mkdir(path.dirname(destinationPath), { recursive: true });
        await fs.copyFile(sourcePath, destinationPath);
      }

      await fs.writeFile(
        path.join(stageDir, ".source.json"),
        `${JSON.stringify(
          {
            kind: "github",
            repo: options.repo,
            ref: options.ref,
            ...(options.commit ? { commit: options.commit } : {}),
            descriptorPath,
            syncedAt,
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      if (options.installProvenance) {
        await writePipelineInstallProvenanceToPackageDir(
          {
            pipelineId: options.pipelineId,
            version: manifest.package.version,
            sourceId: options.installProvenance.sourceId,
            sourceKind: options.installProvenance.sourceKind,
            installedAt: syncedAt,
          },
          stageDir
        );
      }
    },
    {
      replaceExisting: options.replaceExisting,
      beforeLockedInstall: options.beforeLockedInstall,
    }
  );

  return {
    action,
    syncedAt,
    manifest,
  };
}
