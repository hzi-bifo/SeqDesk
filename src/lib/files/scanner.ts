import * as fs from "fs/promises";
import * as path from "path";
import { hasAllowedExtension } from "./paths";

export interface FileInfo {
  /** Absolute path to the file */
  absolutePath: string;
  /** Path relative to the base directory */
  relativePath: string;
  /** Filename only */
  filename: string;
  /** File size in bytes */
  size: number;
  /** Last modified time */
  modifiedAt: Date;
}

export interface ScanOptions {
  /** File extensions to include (e.g., [".fastq.gz", ".fq.gz"]) */
  allowedExtensions: string[];
  /** Maximum directory depth to scan (1 = base only, 2 = one level deep, etc.) */
  maxDepth: number;
  /** Glob patterns for directories/files to ignore */
  ignorePatterns?: string[];
}

interface CacheEntry {
  files: FileInfo[];
  scannedAt: number;
  basePath: string;
  options: ScanOptions;
}

// In-memory cache with TTL
const scanCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generates a cache key from the scan parameters.
 */
function getCacheKey(basePath: string, options: ScanOptions): string {
  return JSON.stringify({
    basePath: path.resolve(basePath),
    extensions: [...options.allowedExtensions].sort(),
    depth: options.maxDepth,
    ignore: options.ignorePatterns ? [...options.ignorePatterns].sort() : [],
  });
}

/**
 * Checks if a path should be ignored based on ignore patterns.
 */
function shouldIgnore(relativePath: string, ignorePatterns: string[]): boolean {
  if (!ignorePatterns || ignorePatterns.length === 0) return false;

  const lowerPath = relativePath.toLowerCase();
  for (const pattern of ignorePatterns) {
    // Simple glob matching: ** = any path, * = any filename part
    const regexPattern = pattern
      .toLowerCase()
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*");
    if (new RegExp(regexPattern).test(lowerPath)) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively scans a directory for files matching the criteria.
 */
async function scanDirectoryRecursive(
  currentPath: string,
  basePath: string,
  options: ScanOptions,
  currentDepth: number,
  results: FileInfo[]
): Promise<void> {
  if (currentDepth > options.maxDepth) return;

  try {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const relativePath = path.relative(basePath, fullPath);

      // Check ignore patterns
      if (shouldIgnore(relativePath, options.ignorePatterns || [])) {
        continue;
      }

      if (entry.isDirectory()) {
        // Recurse into subdirectory
        await scanDirectoryRecursive(
          fullPath,
          basePath,
          options,
          currentDepth + 1,
          results
        );
      } else if (entry.isFile()) {
        // Check if file matches allowed extensions
        if (hasAllowedExtension(entry.name, options.allowedExtensions)) {
          try {
            const stats = await fs.stat(fullPath);
            results.push({
              absolutePath: fullPath,
              relativePath,
              filename: entry.name,
              size: stats.size,
              modifiedAt: stats.mtime,
            });
          } catch {
            // Skip files we can't stat (permission issues, etc.)
          }
        }
      }
    }
  } catch (error) {
    // Skip directories we can't read
    console.warn(`[Scanner] Could not read directory ${currentPath}:`, error);
  }
}

/**
 * Scans a directory for sequencing files.
 *
 * @param basePath - The root directory to scan
 * @param options - Scan options (extensions, depth, ignore patterns)
 * @param force - If true, bypasses cache and forces a fresh scan
 * @returns Array of FileInfo objects for matching files
 */
export async function scanDirectory(
  basePath: string,
  options: ScanOptions,
  force: boolean = false
): Promise<FileInfo[]> {
  const resolvedBase = path.resolve(basePath);
  const cacheKey = getCacheKey(resolvedBase, options);

  // Check cache (unless force refresh)
  if (!force) {
    const cached = scanCache.get(cacheKey);
    if (cached && Date.now() - cached.scannedAt < CACHE_TTL_MS) {
      return cached.files;
    }
  }

  // Verify base path exists and is a directory
  try {
    const stats = await fs.stat(resolvedBase);
    if (!stats.isDirectory()) {
      throw new Error(`${basePath} is not a directory`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Directory does not exist: ${basePath}`);
    }
    throw error;
  }

  // Perform scan
  const results: FileInfo[] = [];
  await scanDirectoryRecursive(resolvedBase, resolvedBase, options, 1, results);

  // Sort by filename for consistent ordering
  results.sort((a, b) => a.filename.localeCompare(b.filename));

  // Update cache
  scanCache.set(cacheKey, {
    files: results,
    scannedAt: Date.now(),
    basePath: resolvedBase,
    options,
  });

  return results;
}

/**
 * Clears the scan cache (useful for testing or manual refresh).
 */
export function clearScanCache(): void {
  scanCache.clear();
}

/**
 * Gets cache stats for debugging.
 */
export function getScanCacheStats(): { entries: number; keys: string[] } {
  return {
    entries: scanCache.size,
    keys: Array.from(scanCache.keys()),
  };
}

/**
 * Checks if a specific file exists and returns its info.
 */
export async function checkFileExists(
  basePath: string,
  relativePath: string
): Promise<FileInfo | null> {
  try {
    const fullPath = path.join(path.resolve(basePath), relativePath);

    // Security: ensure path doesn't escape base
    const resolvedBase = path.resolve(basePath);
    const resolvedFull = path.resolve(fullPath);
    if (!resolvedFull.startsWith(resolvedBase + path.sep)) {
      return null;
    }

    const stats = await fs.stat(fullPath);
    if (!stats.isFile()) {
      return null;
    }

    return {
      absolutePath: fullPath,
      relativePath,
      filename: path.basename(relativePath),
      size: stats.size,
      modifiedAt: stats.mtime,
    };
  } catch {
    return null;
  }
}
