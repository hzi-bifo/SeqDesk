import fs from "fs/promises";
import path from "path";
import type { PackageManifest } from "./package-loader";

export const METAXPATH_PIPELINE_ID = "metaxpath";
export const METAXPATH_REPOSITORY = "hzi-bifo/MetaxPath";
export const METAXPATH_REPO_HTTPS = `https://github.com/${METAXPATH_REPOSITORY}.git`;
export const DEFAULT_METAXPATH_REF = "Nextflow";
export const METAXPATH_DESCRIPTOR_RELATIVE_PATH = ".seqdesk/pipelines/metaxpath";

export const REQUIRED_DESCRIPTOR_FILES = [
  "manifest.json",
  "definition.json",
  "registry.json",
  "samplesheet.yaml",
  "README.md",
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
  return (
    text.includes("remote branch") && text.includes("not found")
  );
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
      error: "Requested Git reference was not found in the MetaxPath repository.",
    };
  }
  return {
    status: 500,
    error: "Failed to clone MetaxPath repository.",
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

export async function validateMetaxPathDescriptorDir(
  descriptorDir: string
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

  if (manifest.package?.id !== METAXPATH_PIPELINE_ID) {
    errors.push(
      `manifest.json package.id must be "${METAXPATH_PIPELINE_ID}" (received "${manifest.package?.id ?? "missing"}").`
    );
  }

  if (manifest.execution?.pipeline !== "./workflow") {
    errors.push('manifest.json execution.pipeline must be "./workflow".');
  }

  if (manifest.execution?.type !== "nextflow") {
    errors.push('manifest.json execution.type must be "nextflow".');
  }

  if (manifest.execution?.version !== DEFAULT_METAXPATH_REF) {
    errors.push(
      `manifest.json execution.version must be "${DEFAULT_METAXPATH_REF}".`
    );
  }

  if (errors.length > 0) {
    return { valid: false, errors, manifest };
  }

  return { valid: true, errors, manifest };
}
