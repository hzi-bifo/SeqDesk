import { constants as fsConstants } from "fs";
import fs from "fs/promises";
import path from "path";
import { getResolvedDataBasePath } from "@/lib/files/data-base-path";
import { getExecutionSettings } from "@/lib/pipelines/execution-settings";

export interface ExploreStorage {
  /** Root for dataset version copies and imports: <dataBasePath>/explore */
  baseDir: string;
  datasetsRoot: string;
  importsRoot: string;
  /** Root for analysis run folders: lives under the pipeline run dir so SLURM nodes share it. */
  runsRoot: string;
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Resolve the Explore storage roots.
 *
 * Datasets live next to the other app data (data base path). Analysis run
 * folders live under the configured pipeline run directory, which is the one
 * location every SLURM compute node can already reach. `SEQDESK_EXPLORE_DIR`
 * overrides the dataset root for tests and unusual installs.
 */
export async function resolveExploreStorage(): Promise<ExploreStorage> {
  const override = trimToUndefined(process.env.SEQDESK_EXPLORE_DIR);
  let baseDir: string;
  if (override) {
    baseDir = path.resolve(override);
  } else {
    const resolved = await getResolvedDataBasePath();
    if (resolved.dataBasePath) {
      baseDir = path.join(path.resolve(resolved.dataBasePath), "explore");
    } else {
      // Development fallback: keep everything inside the repo's work dir.
      baseDir = path.join(process.cwd(), "work", "explore");
    }
  }

  const settings = await getExecutionSettings();
  const runsOverride = trimToUndefined(process.env.SEQDESK_EXPLORE_RUN_DIR);
  const runsRoot = runsOverride
    ? path.resolve(runsOverride)
    : path.join(path.resolve(settings.pipelineRunDir), "explore");

  const datasetsRoot = path.join(baseDir, "datasets");
  const importsRoot = path.join(baseDir, "imports");
  await fs.mkdir(datasetsRoot, { recursive: true });
  await fs.mkdir(importsRoot, { recursive: true });
  await fs.access(baseDir, fsConstants.W_OK);

  return { baseDir, datasetsRoot, importsRoot, runsRoot };
}

export function isPathInsideBase(targetPath: string, basePath: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedBase = path.resolve(basePath);
  const relative = path.relative(resolvedBase, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolve a file inside a base directory, refusing lexical and symlink
 * escapes. Mirrors the realpath containment used by the pipeline file route.
 */
export async function resolveContainedPath(basePath: string, relativeOrAbsolute: string): Promise<string> {
  const candidate = path.isAbsolute(relativeOrAbsolute)
    ? path.resolve(relativeOrAbsolute)
    : path.resolve(basePath, relativeOrAbsolute);
  if (!isPathInsideBase(candidate, basePath)) {
    throw new Error("Path escapes the Explore storage root");
  }
  const [realBase, realTarget] = await Promise.all([fs.realpath(basePath), fs.realpath(candidate)]);
  if (!isPathInsideBase(realTarget, realBase)) {
    throw new Error("Path escapes the Explore storage root");
  }
  return realTarget;
}

export function sanitizeSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "item"
  );
}
