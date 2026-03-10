import fs from "fs/promises";
import path from "path";
import type { PackageManifest } from "./package-loader";
import { installPackageDirectory } from "./package-install";
import {
  METAXPATH_DESCRIPTOR_RELATIVE_PATH,
  METAXPATH_PIPELINE_ID,
  METAXPATH_REPOSITORY,
} from "./metaxpath-config";

export {
  DEFAULT_METAXPATH_REF,
  METAXPATH_DESCRIPTOR_RELATIVE_PATH,
  METAXPATH_PIPELINE_ID,
  METAXPATH_REPOSITORY,
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
  descriptorPath?: string;
  includeWorkflow?: boolean;
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
  pipelineId: string,
  manifest: PackageManifest,
  includeWorkflow?: boolean
): boolean {
  if (typeof includeWorkflow === "boolean") return includeWorkflow;
  return pipelineId === METAXPATH_PIPELINE_ID || manifest.execution.pipeline === "./workflow";
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

  for (const fileName of REQUIRED_DESCRIPTOR_FILES) {
    const filePath = path.join(descriptorDir, fileName);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        errors.push(`Descriptor file is not a regular file: ${fileName}`);
      }
    } catch {
      errors.push(`Missing descriptor file: ${fileName}`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const manifestPath = path.join(descriptorDir, "manifest.json");
  let manifest: PackageManifest | undefined;
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    manifest = JSON.parse(raw) as PackageManifest;
  } catch {
    errors.push("manifest.json is not valid JSON.");
    return { valid: false, errors };
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
  const pipelinesDir = path.join(process.cwd(), "pipelines");
  const descriptorPath = getDescriptorPath(options.pipelineId, options.descriptorPath);
  const descriptorDir = path.join(options.cloneDir, descriptorPath);
  const validation = await validatePipelineDescriptorDir(
    descriptorDir,
    options.pipelineId
  );
  if (!validation.valid) {
    throw new Error(validation.errors.join(" "));
  }

  const manifest = validation.manifest;
  const syncedAt = new Date().toISOString();
  const action = await installPackageDirectory(
    pipelinesDir,
    options.pipelineId,
    async (stageDir) => {
      for (const fileName of REQUIRED_DESCRIPTOR_FILES) {
        await fs.copyFile(
          path.join(descriptorDir, fileName),
          path.join(stageDir, fileName)
        );
      }

      const readmePath = path.join(descriptorDir, "README.md");
      try {
        const stat = await fs.stat(readmePath);
        if (stat.isFile()) {
          await fs.copyFile(readmePath, path.join(stageDir, "README.md"));
        }
      } catch {
        // README is optional for generic GitHub installs.
      }

      if (manifest && shouldRequireWorkflowSnapshot(options.pipelineId, manifest, options.includeWorkflow)) {
        const workflowDir = path.join(stageDir, "workflow");
        await fs.mkdir(workflowDir, { recursive: true });
        const rootEntries = await fs.readdir(options.cloneDir, { withFileTypes: true });
        for (const entry of rootEntries) {
          if (!shouldCopyWorkflowEntry(entry.name)) continue;
          const sourcePath = path.join(options.cloneDir, entry.name);
          const destinationPath = path.join(workflowDir, entry.name);
          await fs.cp(sourcePath, destinationPath, { recursive: true });
        }
      }

      await fs.writeFile(
        path.join(stageDir, ".source.json"),
        `${JSON.stringify(
          {
            kind: "github",
            repo: options.repo,
            ref: options.ref,
            descriptorPath,
            syncedAt,
          },
          null,
          2
        )}\n`,
        "utf8"
      );
    }
  );

  return {
    action,
    syncedAt,
    manifest,
  };
}
