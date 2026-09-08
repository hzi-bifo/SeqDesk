import fs from "fs/promises";
import path from "path";
import { KitSchema, type KitManifest } from "./schema";

export interface LoadedKit {
  manifest: KitManifest;
  dir: string;
  code: string;
  readme: string | null;
  hasTestData: boolean;
}

export function getKitsDir(): string {
  const override = process.env.SEQDESK_EXPLORE_KITS_DIR?.trim();
  return override ? path.resolve(override) : path.join(process.cwd(), "explore", "kits");
}

export function getEnvironmentsDir(): string {
  const override = process.env.SEQDESK_EXPLORE_ENVIRONMENTS_DIR?.trim();
  return override ? path.resolve(override) : path.join(process.cwd(), "explore", "environments");
}

export function getHelperLibDir(): string {
  return path.join(process.cwd(), "explore", "lib");
}

/**
 * Copy the seqdesk_explore helper package into `<runFolder>/lib/python`.
 * Compute nodes share the run directory but not the app checkout, so the
 * wrapper must import the helper from inside the run folder; the copy also
 * freezes the helper version a run used. Returns the staged lib directory.
 */
export async function stageHelperLibrary(runFolder: string): Promise<string> {
  const source = path.join(getHelperLibDir(), "python", "seqdesk_explore");
  const libDir = path.join(runFolder, "lib");
  const target = path.join(libDir, "python", "seqdesk_explore");
  await fs.rm(target, { recursive: true, force: true });
  await fs.cp(source, target, {
    recursive: true,
    filter: (entry) => path.basename(entry) !== "__pycache__" && !entry.endsWith(".pyc"),
  });
  return libDir;
}

export interface KitLoadProblem {
  kitDir: string;
  message: string;
}

/**
 * Load every kit under the kits directory. Invalid kits are reported, not
 * thrown, so one broken contribution never hides the others.
 */
export async function loadKits(): Promise<{ kits: LoadedKit[]; problems: KitLoadProblem[] }> {
  const root = getKitsDir();
  const kits: LoadedKit[] = [];
  const problems: KitLoadProblem[] = [];
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return { kits, problems };
  }
  for (const name of entries) {
    const dir = path.join(root, name);
    try {
      const raw = JSON.parse(await fs.readFile(path.join(dir, "kit.json"), "utf8")) as unknown;
      const manifest = KitSchema.parse(raw);
      if (manifest.id !== name) {
        problems.push({ kitDir: dir, message: `kit id "${manifest.id}" does not match its directory name "${name}"` });
        continue;
      }
      const code = await fs.readFile(path.join(dir, manifest.entrypoint), "utf8");
      const readme = await fs.readFile(path.join(dir, "README.md"), "utf8").catch(() => null);
      const hasTestData = await fs
        .stat(path.join(dir, "test-data"))
        .then((stat) => stat.isDirectory())
        .catch(() => false);
      kits.push({ manifest, dir, code, readme, hasTestData });
    } catch (error) {
      problems.push({ kitDir: dir, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { kits, problems };
}

export async function getKit(id: string): Promise<LoadedKit | null> {
  const { kits } = await loadKits();
  return kits.find((kit) => kit.manifest.id === id) ?? null;
}

export function serializeKit(kit: LoadedKit) {
  return {
    ...kit.manifest,
    readme: kit.readme,
    hasTestData: kit.hasTestData,
  };
}
