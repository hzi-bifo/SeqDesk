import fs from "fs";
import path from "path";

const PIPELINE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_PIPELINE_ID_LENGTH = 128;
const INSTALL_WORKING_DIRECTORY_MARKERS = [".__tmp-", ".__backup-"];

export function isValidPipelineId(pipelineId: string): boolean {
  return (
    pipelineId.length > 0 &&
    pipelineId.length <= MAX_PIPELINE_ID_LENGTH &&
    PIPELINE_ID_PATTERN.test(pipelineId) &&
    !INSTALL_WORKING_DIRECTORY_MARKERS.some((marker) =>
      pipelineId.includes(marker)
    )
  );
}

export function assertValidPipelineId(pipelineId: string): void {
  if (!isValidPipelineId(pipelineId)) {
    throw new Error(
      "Invalid pipeline ID. Use letters, numbers, dots, underscores, or hyphens, starting with a letter or number."
    );
  }
}

export function resolvePathWithinDirectory(
  baseDir: string,
  relativePath: string,
  label = "path",
  options: { allowBase?: boolean } = {}
): string {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new Error(`Invalid empty ${label}.`);
  }
  if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    throw new Error(`Invalid absolute ${label}: ${relativePath}`);
  }

  const baseResolved = path.resolve(baseDir);
  const resolved = path.resolve(baseResolved, relativePath);
  const relative = path.relative(baseResolved, resolved);
  if (
    (!options.allowBase && relative.length === 0) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Invalid ${label} outside allowed directory: ${relativePath}`);
  }
  return resolved;
}

export function resolvePipelinePackageDir(
  pipelinesDir: string,
  pipelineId: string
): string {
  assertValidPipelineId(pipelineId);
  return resolvePathWithinDirectory(pipelinesDir, pipelineId, "pipeline ID");
}

export function isInstallWorkingDirectory(name: string): boolean {
  return INSTALL_WORKING_DIRECTORY_MARKERS.some((marker) =>
    name.includes(marker)
  );
}

export function isLocalPipelineReference(value: string): boolean {
  return (
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    value === "." ||
    value === ".." ||
    value.startsWith("./") ||
    value.startsWith("../")
  );
}

/**
 * Only runners that are actually dispatched by pipeline-run-service may omit
 * their local Nextflow target. Treating every `runner: "custom"` package as
 * supported would let an install pass validation and fail only when started.
 */
export function hasSupportedCustomPipelineRunner(manifest: unknown): boolean {
  if (!manifest || typeof manifest !== "object") return false;

  const candidate = manifest as {
    package?: unknown;
    execution?: unknown;
  };
  const packageMetadata =
    candidate.package && typeof candidate.package === "object"
      ? (candidate.package as Record<string, unknown>)
      : undefined;
  const execution =
    candidate.execution && typeof candidate.execution === "object"
      ? (candidate.execution as Record<string, unknown>)
      : undefined;

  if (packageMetadata?.id !== "submg") return false;
  return (
    execution?.runner === "custom" ||
    execution?.customRunner === "custom"
  );
}

/**
 * Resolve the canonical directory used for installed pipeline packages.
 *
 * Keep this helper independent of package loading so installers and the loader
 * cannot drift or create a circular dependency.
 */
export function getPipelinesDir(): string {
  const override = process.env.SEQDESK_PIPELINES_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }

  const possiblePaths = [
    path.join(process.cwd(), "pipelines"),
    path.join(process.cwd(), "..", "pipelines"),
  ];

  for (const candidate of possiblePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return possiblePaths[0];
}
