import * as fs from "fs/promises";
import * as path from "path";

export interface SequencingBrowsableFile {
  relativePath: string;
  filename: string;
  size: number;
  modifiedAt: Date;
}

function shouldIgnore(relativePath: string, ignorePatterns: string[]): boolean {
  const lowerPath = relativePath.toLowerCase();
  return ignorePatterns.some((pattern) => {
    const regexPattern = pattern
      .toLowerCase()
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*");
    return new RegExp(regexPattern).test(lowerPath);
  });
}

async function walkDirectory(
  currentPath: string,
  basePath: string,
  depth: number,
  maxDepth: number,
  ignorePatterns: string[],
  results: SequencingBrowsableFile[],
  limit: number
) {
  if (depth > maxDepth || results.length >= limit) {
    return;
  }

  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= limit) {
      return;
    }

    const fullPath = path.join(currentPath, entry.name);
    const relativePath = path.relative(basePath, fullPath);
    if (shouldIgnore(relativePath, ignorePatterns)) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkDirectory(
        fullPath,
        basePath,
        depth + 1,
        maxDepth,
        ignorePatterns,
        results,
        limit
      );
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    try {
      const stats = await fs.stat(fullPath);
      results.push({
        relativePath,
        filename: entry.name,
        size: stats.size,
        modifiedAt: stats.mtime,
      });
    } catch {
      continue;
    }
  }
}

export async function browseSequencingStorageFiles(
  basePath: string,
  options?: {
    search?: string;
    maxDepth?: number;
    ignorePatterns?: string[];
    limit?: number;
  }
): Promise<SequencingBrowsableFile[]> {
  const resolvedBase = path.resolve(basePath);
  const maxDepth = options?.maxDepth ?? 4;
  const ignorePatterns = options?.ignorePatterns ?? [];
  const limit = options?.limit ?? 250;
  const search = options?.search?.trim().toLowerCase() ?? "";
  const results: SequencingBrowsableFile[] = [];

  await walkDirectory(
    resolvedBase,
    resolvedBase,
    1,
    maxDepth,
    ignorePatterns,
    results,
    limit
  );

  const filtered = search
    ? results.filter(
        (file) =>
          file.filename.toLowerCase().includes(search) ||
          file.relativePath.toLowerCase().includes(search)
      )
    : results;

  return filtered.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
}
