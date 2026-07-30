import fs from "fs";
import { promises as fsPromises } from "fs";
import path from "path";
import { randomUUID } from "crypto";

/**
 * Hidden marker changed after every successful package-directory swap.
 *
 * Package readers are intentionally synchronous, so they compare this small
 * token before serving their in-memory cache. The writer uses a same-directory
 * rename to ensure readers see either the old complete token or the new one.
 */
export const PIPELINE_PACKAGE_GENERATION_FILE =
  ".seqdesk-package-generation";

const MISSING_GENERATION = "<missing>";

export function getPipelinePackageGenerationPath(
  pipelinesDir: string
): string {
  return path.join(
    path.resolve(pipelinesDir),
    PIPELINE_PACKAGE_GENERATION_FILE
  );
}

export function readPipelinePackageGenerationSync(
  pipelinesDir: string
): string {
  const generationPath = getPipelinePackageGenerationPath(pipelinesDir);
  try {
    return fs.readFileSync(generationPath, "utf8").trim() || MISSING_GENERATION;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return MISSING_GENERATION;
    }

    // A transient read error must not pin a long-lived process to its old
    // package cache. Include the error code so a later successful read differs.
    return `<unreadable:${(error as NodeJS.ErrnoException).code ?? "unknown"}>`;
  }
}

export async function advancePipelinePackageGeneration(
  pipelinesDir: string
): Promise<string> {
  const resolvedPipelinesDir = path.resolve(pipelinesDir);
  const generationPath = getPipelinePackageGenerationPath(
    resolvedPipelinesDir
  );
  const generation = `${Date.now()}-${process.pid}-${randomUUID()}`;
  const tempPath = path.join(
    resolvedPipelinesDir,
    `${PIPELINE_PACKAGE_GENERATION_FILE}.tmp-${randomUUID()}`
  );

  await fsPromises.mkdir(resolvedPipelinesDir, { recursive: true });
  try {
    await fsPromises.writeFile(tempPath, `${generation}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await fsPromises.rename(tempPath, generationPath);
  } catch (error) {
    await fsPromises.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }

  return generation;
}
