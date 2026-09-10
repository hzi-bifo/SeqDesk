import { stat } from "fs/promises";
import { isAbsolute } from "node:path";
import { safeJoin, toRelativePath } from "@/lib/files";

interface LinkedReadFiles {
  file1?: string | null;
  file2?: string | null;
}

/** Uses the same storage root and traversal protection as sequencing file access. */
export async function inspectReadFiles(basePath: string | null, read: LinkedReadFiles): Promise<{
  fileSize1: number | null;
  fileSize2: number | null;
  filesMissing: boolean | null;
}> {
  const result = { fileSize1: null as number | null, fileSize2: null as number | null, filesMissing: null as boolean | null };
  if (!basePath) return result;
  let missing = false;
  let unverified = false;
  await Promise.all((["file1", "file2"] as const).map(async (key) => {
    const file = read[key];
    if (!file) return;
    let absolutePath: string;
    try {
      const relativePath = isAbsolute(file) ? toRelativePath(basePath, file) : file;
      absolutePath = safeJoin(basePath, relativePath);
    } catch {
      missing = true;
      return;
    }
    try {
      const details = await stat(absolutePath);
      if (!details.isFile()) {
        missing = true;
        return;
      }
      result[key === "file1" ? "fileSize1" : "fileSize2"] = details.size;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT" || code === "ENOTDIR") missing = true;
      else unverified = true;
    }
  }));
  result.filesMissing = missing ? true : unverified ? null : false;
  return result;
}
