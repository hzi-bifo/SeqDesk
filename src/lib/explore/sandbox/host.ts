import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import { carveOutDenies, carveOutListingDirs, type MountPlan, type SandboxPlatform, type SystemEntry } from "./mount-plan";

const execFileAsync = promisify(execFile);
const SYSTEM_DIRS = ["/usr", "/etc", "/bin", "/sbin", "/lib", "/lib32", "/lib64"];

export interface HostFacts {
  platform: SandboxPlatform | null;
  /** Path of the sandbox tool (bwrap or sandbox-exec), or null when absent. */
  tool: string | null;
  toolName: "bubblewrap" | "seatbelt" | null;
  system: Record<string, SystemEntry>;
  sss: boolean;
  hostHome: string;
  tmpRoot: string;
  /** Present when the tool exists but cannot create namespaces (bubblewrap only). */
  problem: string | null;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function which(command: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("sh", ["-c", `command -v ${command}`], { timeout: 5000 });
    const found = stdout.trim().split("\n")[0]?.trim();
    return found && path.isAbsolute(found) ? found : null;
  } catch {
    return null;
  }
}

let cached: { at: number; facts: HostFacts } | null = null;

/**
 * What the host offers for sandboxing. Cached for a minute: the answer only
 * changes when someone installs bubblewrap.
 */
export async function collectHostFacts(options: { platform?: NodeJS.Platform; fresh?: boolean } = {}): Promise<HostFacts> {
  if (!options.fresh && cached && Date.now() - cached.at < 60_000) return cached.facts;
  const nodePlatform = options.platform ?? process.platform;
  const platform: SandboxPlatform | null = nodePlatform === "linux" ? "linux" : nodePlatform === "darwin" ? "darwin" : null;
  const system: Record<string, SystemEntry> = {};
  if (platform === "linux") {
    for (const dir of SYSTEM_DIRS) {
      try {
        const stat = await fs.lstat(dir);
        if (stat.isSymbolicLink()) system[dir] = { symlink: await fs.readlink(dir) };
        else if (stat.isDirectory()) system[dir] = { exists: true };
      } catch {
        // absent on this host
      }
    }
  }
  let tool: string | null = null;
  let toolName: HostFacts["toolName"] = null;
  let problem: string | null = null;
  if (platform === "linux") {
    tool = await which("bwrap");
    toolName = tool ? "bubblewrap" : null;
    if (tool) {
      try {
        await execFileAsync(tool, ["--ro-bind", "/", "/", "--unshare-all", "--die-with-parent", "true"], { timeout: 10_000 });
      } catch (error) {
        problem = `bubblewrap is installed but cannot create namespaces: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
      }
    }
  } else if (platform === "darwin") {
    tool = (await which("sandbox-exec")) ?? (await exists("/usr/bin/sandbox-exec") ? "/usr/bin/sandbox-exec" : null);
    toolName = tool ? "seatbelt" : null;
  }
  const facts: HostFacts = {
    platform,
    tool,
    toolName,
    system,
    sss: platform === "linux" && (await exists("/var/lib/sss")),
    hostHome: os.homedir(),
    tmpRoot: os.tmpdir(),
    problem,
  };
  cached = { at: Date.now(), facts };
  return facts;
}

/** Real paths of the given logical paths, for hosts where a root is a symlink (/tmp on macOS). */
export async function realPathMap(paths: Array<string | null | undefined>): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const logical of paths) {
    if (!logical) continue;
    try {
      const real = await fs.realpath(logical);
      if (real !== logical) map[logical] = real;
    } catch {
      // the path does not exist yet; it is used as is
    }
  }
  return map;
}

/**
 * Seatbelt cannot re-allow a descendant of a denied root, so the private
 * roots are not denied as a whole: every sibling on the way to an allowed
 * bind is denied instead. Lists the directories once and fills plan.denyRead.
 */
export async function applyDarwinDenies(plan: MountPlan): Promise<MountPlan> {
  if (plan.platform !== "darwin") return plan;
  const allowed = plan.binds.map((bind) => bind.src);
  const listings = new Map<string, string[] | null>();
  for (const root of plan.denyRoots) {
    for (const candidate of allowed.filter((entry) => entry === root || entry.startsWith(`${root}/`))) {
      let dir = root;
      for (const segment of path.relative(root, candidate).split(path.sep).filter(Boolean)) {
        if (!listings.has(dir)) {
          try {
            listings.set(dir, await fs.readdir(dir));
          } catch {
            listings.set(dir, null);
          }
        }
        dir = path.join(dir, segment);
      }
    }
  }
  const denies = new Set<string>();
  const listing = new Set<string>();
  for (const root of plan.denyRoots) {
    for (const deny of carveOutDenies(root, allowed, (dir) => listings.get(dir) ?? null)) denies.add(deny);
    for (const dir of carveOutListingDirs(root, allowed, [plan.chdir])) listing.add(dir);
  }
  plan.denyRead = [...denies].sort();
  plan.denyListing = [...listing].sort();
  return plan;
}
