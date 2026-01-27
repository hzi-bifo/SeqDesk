import * as path from "path";

/**
 * Ensures a target path is within the base path (prevents path traversal attacks).
 * Returns the resolved absolute path if valid, throws if attempting to escape base.
 */
export function ensureWithinBase(basePath: string, target: string): string {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(basePath, target);

  if (!resolvedTarget.startsWith(resolvedBase + path.sep) && resolvedTarget !== resolvedBase) {
    throw new Error(`Path traversal detected: ${target} escapes base path`);
  }

  return resolvedTarget;
}

/**
 * Converts an absolute path to a path relative to the base.
 * Throws if the path is not under the base path.
 */
export function toRelativePath(basePath: string, fullPath: string): string {
  const resolvedBase = path.resolve(basePath);
  const resolvedFull = path.resolve(fullPath);

  if (!resolvedFull.startsWith(resolvedBase + path.sep) && resolvedFull !== resolvedBase) {
    throw new Error(`Path ${fullPath} is not under base path ${basePath}`);
  }

  return path.relative(resolvedBase, resolvedFull);
}

/**
 * Joins a relative path to a base path safely.
 * Throws if the result would escape the base path.
 */
export function safeJoin(basePath: string, relativePath: string): string {
  // Reject paths starting with / or containing ..
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Absolute paths not allowed: ${relativePath}`);
  }

  if (relativePath.includes("..")) {
    throw new Error(`Path traversal not allowed: ${relativePath}`);
  }

  return ensureWithinBase(basePath, relativePath);
}

/**
 * Checks if a file path has one of the allowed extensions.
 */
export function hasAllowedExtension(filePath: string, allowedExtensions: string[]): boolean {
  const lowerPath = filePath.toLowerCase();
  return allowedExtensions.some(ext => lowerPath.endsWith(ext.toLowerCase()));
}

/**
 * Extracts the sample identifier from a filename by removing:
 * - Extensions (.fastq.gz, .fq.gz, etc.)
 * - Read identifiers (_R1, _R2, _1, _2, .R1, .R2)
 * - Lane info (_L001, _L002, etc.)
 * - Sample number (_S1, _S2, etc.)
 * - Illumina suffix (_001)
 */
export function extractSampleIdentifier(filename: string): string {
  let name = filename;

  // Remove common extensions
  const extensions = [".fastq.gz", ".fq.gz", ".fastq", ".fq"];
  for (const ext of extensions) {
    if (name.toLowerCase().endsWith(ext)) {
      name = name.slice(0, -ext.length);
      break;
    }
  }

  // Remove Illumina-style suffixes: _001, _002, etc.
  name = name.replace(/_00\d$/, "");

  // Remove read identifiers: _R1, _R2, _1, _2, .R1, .R2
  name = name.replace(/[._]R[12]$/i, "");
  name = name.replace(/[._][12]$/i, "");

  // Remove lane info: _L001, _L002, etc.
  name = name.replace(/_L\d{3}$/i, "");

  // Remove sample number: _S1, _S2, etc.
  name = name.replace(/_S\d+$/i, "");

  return name;
}

/**
 * Determines if a filename is a Read 1 (forward) file.
 */
export function isRead1File(filename: string): boolean {
  const lowerName = filename.toLowerCase();
  // Match patterns like _R1, .R1, _1 (before extension)
  return /[._]r1[._]|[._]r1_\d{3}[._]|[._]1[._]/i.test(lowerName) ||
         /[._]r1\.f(ast)?q/i.test(lowerName) ||
         /[._]1\.f(ast)?q/i.test(lowerName);
}

/**
 * Determines if a filename is a Read 2 (reverse) file.
 */
export function isRead2File(filename: string): boolean {
  const lowerName = filename.toLowerCase();
  // Match patterns like _R2, .R2, _2 (before extension)
  return /[._]r2[._]|[._]r2_\d{3}[._]|[._]2[._]/i.test(lowerName) ||
         /[._]r2\.f(ast)?q/i.test(lowerName) ||
         /[._]2\.f(ast)?q/i.test(lowerName);
}

/**
 * Gets the paired file path by swapping R1/R2 or 1/2 in the filename.
 */
export function getPairedFilePath(filePath: string): string | null {
  const dir = path.dirname(filePath);
  const filename = path.basename(filePath);

  let pairedFilename: string | null = null;

  if (isRead1File(filename)) {
    // R1 -> R2
    pairedFilename = filename
      .replace(/([._])R1([._])/gi, "$1R2$2")
      .replace(/([._])R1_(\d{3})([._])/gi, "$1R2_$2$3")
      .replace(/([._])R1(\.f)/gi, "$1R2$2")
      .replace(/([._])1([._])/g, "$12$2")
      .replace(/([._])1(\.f)/gi, "$12$2");
  } else if (isRead2File(filename)) {
    // R2 -> R1
    pairedFilename = filename
      .replace(/([._])R2([._])/gi, "$1R1$2")
      .replace(/([._])R2_(\d{3})([._])/gi, "$1R1_$2$3")
      .replace(/([._])R2(\.f)/gi, "$1R1$2")
      .replace(/([._])2([._])/g, "$11$2")
      .replace(/([._])2(\.f)/gi, "$11$2");
  }

  if (pairedFilename && pairedFilename !== filename) {
    return path.join(dir, pairedFilename);
  }

  return null;
}
