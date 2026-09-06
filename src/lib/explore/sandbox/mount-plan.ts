import path from "path";
import { createHash } from "crypto";

/**
 * A mount plan is the one description of what an analysis process can see.
 * It is built by a pure function from facts the host collected beforehand,
 * checked against a small set of invariants, and rendered for a concrete
 * mechanism: bubblewrap on Linux, sandbox-exec (Seatbelt) on macOS. The plan
 * has no filesystem or process I/O, so it is testable, and it is written
 * next to the run (control/mount-plan.json) as the audit record of a run's
 * isolation.
 *
 * The model is an allowlist: nothing exists inside the sandbox unless the
 * plan says so. Other runs, the tables storage, the app checkout and the
 * real home directory are absent rather than masked.
 *
 * The plan format follows the one used by the agent runner (CAMI-agent,
 * automation/server/lib/mountPlan.js) so the two can share it later.
 */
export const MOUNT_PLAN_SCHEMA_VERSION = 1;

export type SandboxPlatform = "linux" | "darwin";
export type SandboxNetwork = "none" | "host";

export type BindPurpose = "system" | "environment" | "condaPackages" | "extra" | "run";

const READ_ONLY_PURPOSES = new Set<BindPurpose>(["system", "environment", "condaPackages", "extra"]);
const READ_WRITE_PURPOSES = new Set<BindPurpose>(["run"]);

const SYSTEM_DIRS = ["/usr", "/etc", "/bin", "/sbin", "/lib", "/lib32", "/lib64"];

export interface SystemEntry {
  exists?: boolean;
  /** The directory is a symlink on the host (merged-/usr layouts): recreate the link inside. */
  symlink?: string;
}

export interface MountBind {
  src: string;
  dst: string;
  mode: "ro" | "rw";
  purpose: BindPurpose;
}

export type SystemMount = { type: "ro-bind"; src: string; dst: string } | { type: "symlink"; target: string; dst: string } | { type: "proc"; dst: string } | { type: "dev"; dst: string };

export interface MountPlan {
  schemaVersion: number;
  platform: SandboxPlatform;
  network: SandboxNetwork;
  namespaces: string[];
  chdir: string;
  /** HOME inside the sandbox: a folder of the run, so nothing of the real home is seen. */
  home: string;
  system: SystemMount[];
  tmpfs: string[];
  binds: MountBind[];
  /** Seatbelt only: the roots whose contents are private; carve-outs are computed by the host. */
  denyRoots: string[];
  denyRead: string[];
  darwinWriteRoots: string[];
}

export interface MountPlanInput {
  platform: SandboxPlatform;
  network?: SandboxNetwork;
  /** The run folder: the only writable place. */
  runFolder: string;
  /** The conda prefix of the analysis environment. */
  environmentPrefix: string;
  /** Conda package caches the prefix may hard- or symlink into. */
  condaPackageDirs?: string[];
  /** Site tool trees an admin exposes read-only. */
  extraReadOnly?: string[];
  /** Roots that hold other runs' and tables' data; they must never be reachable. */
  roots: {
    runsRoot?: string | null;
    datasetsRoot?: string | null;
    exploreBase?: string | null;
    appDir?: string | null;
    hostHome?: string | null;
    tmpRoot?: string | null;
  };
  host: {
    system?: Record<string, SystemEntry>;
    /** sssd client pipes present: LDAP users need them to resolve their own name. */
    sss?: boolean;
  };
  /** Logical path -> real path (symlinks resolved); Seatbelt matches real paths. */
  realPaths?: Record<string, string>;
}

export function buildMountPlan(input: MountPlanInput): MountPlan {
  const { platform } = input;
  if (platform !== "linux" && platform !== "darwin") throw new Error(`No sandbox for platform ${String(platform)}`);
  const network: SandboxNetwork = input.network === "host" ? "host" : "none";
  const realPaths = input.realPaths ?? {};
  const srcOf = (logical: string) => realPaths[logical] ?? logical;
  const runFolder = input.runFolder;
  if (!path.isAbsolute(runFolder)) throw new Error("The run folder must be an absolute path");
  if (!path.isAbsolute(input.environmentPrefix)) throw new Error("The environment prefix must be an absolute path");

  const system: SystemMount[] = [];
  const tmpfs: string[] = [];
  const binds: MountBind[] = [];

  if (platform === "linux") {
    for (const dir of SYSTEM_DIRS) {
      const entry = input.host.system?.[dir];
      if (!entry) continue;
      if (entry.symlink) system.push({ type: "symlink", target: entry.symlink, dst: dir });
      else if (entry.exists) system.push({ type: "ro-bind", src: dir, dst: dir });
    }
    system.push({ type: "proc", dst: "/proc" });
    system.push({ type: "dev", dst: "/dev" });
    tmpfs.push("/tmp", "/var/tmp", "/run", "/var", "/home", "/root", "/opt");
    if (input.host.sss) binds.push({ src: "/var/lib/sss", dst: "/var/lib/sss", mode: "ro", purpose: "system" });
  }

  binds.push({ src: srcOf(runFolder), dst: runFolder, mode: "rw", purpose: "run" });
  binds.push({ src: srcOf(input.environmentPrefix), dst: input.environmentPrefix, mode: "ro", purpose: "environment" });
  for (const dir of uniqueStrings(input.condaPackageDirs ?? [])) {
    if (path.isAbsolute(dir)) binds.push({ src: srcOf(dir), dst: dir, mode: "ro", purpose: "condaPackages" });
  }
  for (const extra of uniqueStrings(input.extraReadOnly ?? [])) {
    if (path.isAbsolute(extra)) binds.push({ src: srcOf(extra), dst: extra, mode: "ro", purpose: "extra" });
  }

  const namespaces = ["user", "pid", "ipc", "uts", "cgroup"];
  if (network === "none") namespaces.push("net");

  const roots = input.roots;
  const plan: MountPlan = {
    schemaVersion: MOUNT_PLAN_SCHEMA_VERSION,
    platform,
    network,
    namespaces,
    chdir: runFolder,
    home: path.join(runFolder, "home"),
    system,
    tmpfs,
    binds: sortBinds(binds),
    denyRoots:
      platform === "darwin"
        ? uniqueStrings([roots.runsRoot, roots.datasetsRoot, roots.exploreBase, roots.appDir, roots.hostHome].filter((value): value is string => Boolean(value)).map(srcOf))
        : [],
    denyRead: [],
    darwinWriteRoots: platform === "darwin" ? uniqueStrings([roots.tmpRoot ?? "", "/private/tmp", "/tmp"]) : [],
  };
  validateMountPlan(plan, {
    runFolder: srcOf(runFolder),
    runsRoot: roots.runsRoot ? srcOf(roots.runsRoot) : null,
    datasetsRoot: roots.datasetsRoot ? srcOf(roots.datasetsRoot) : null,
    appDir: roots.appDir ? srcOf(roots.appDir) : null,
  });
  return plan;
}

export interface PlanContext {
  runFolder: string;
  runsRoot?: string | null;
  datasetsRoot?: string | null;
  appDir?: string | null;
}

/** The invariants every plan must hold; throws with every violation listed. */
export function validateMountPlan(plan: MountPlan, context: PlanContext): true {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const bind of plan.binds) {
    if (!path.isAbsolute(bind.src) || !path.isAbsolute(bind.dst)) {
      errors.push(`bind paths must be absolute: ${JSON.stringify(bind)}`);
      continue;
    }
    if (bind.src === "/" || bind.dst === "/") errors.push("binding the filesystem root is not allowed");
    if (seen.has(bind.dst)) errors.push(`duplicate bind destination: ${bind.dst}`);
    seen.add(bind.dst);
    const ro = READ_ONLY_PURPOSES.has(bind.purpose);
    const rw = READ_WRITE_PURPOSES.has(bind.purpose);
    if (!ro && !rw) errors.push(`unknown bind purpose: ${bind.purpose}`);
    if (ro && bind.mode !== "ro") errors.push(`${bind.purpose} bind must be read-only: ${bind.dst}`);
    if (rw && bind.mode !== "rw") errors.push(`${bind.purpose} bind must be read-write: ${bind.dst}`);
    if (bind.mode === "rw" && !isWithin(bind.src, context.runFolder)) errors.push(`read-write bind outside the run folder: ${bind.src}`);
    if (context.runsRoot && isWithin(bind.src, context.runsRoot) && !isWithin(bind.src, context.runFolder)) errors.push(`bind reaches into another run: ${bind.src}`);
    if (context.datasetsRoot && isWithin(bind.src, context.datasetsRoot)) errors.push(`bind exposes the tables storage: ${bind.src}`);
    // In development the storage lives under the checkout; the run folder itself is fine there.
    if (context.appDir && isWithin(bind.src, context.appDir) && !isWithin(bind.src, context.runFolder)) errors.push(`bind exposes the application directory: ${bind.src}`);
  }
  if (plan.network !== "none" && plan.network !== "host") errors.push(`unknown network mode: ${String(plan.network)}`);
  if (errors.length > 0) throw new Error(`Invalid mount plan:\n- ${errors.join("\n- ")}`);
  return true;
}

/** bubblewrap arguments; the caller appends `--` and the command. */
export function renderBwrapArgs(plan: MountPlan): string[] {
  if (plan.platform !== "linux") throw new Error("bubblewrap arguments can only be rendered for Linux plans");
  const args: string[] = [];
  for (const namespace of plan.namespaces) {
    if (namespace === "user") args.push("--unshare-user-try");
    else if (namespace === "cgroup") args.push("--unshare-cgroup-try");
    else args.push(`--unshare-${namespace}`);
  }
  args.push("--die-with-parent", "--new-session");
  for (const entry of plan.system) {
    if (entry.type === "ro-bind") args.push("--ro-bind", entry.src, entry.dst);
    else if (entry.type === "symlink") args.push("--symlink", entry.target, entry.dst);
    else if (entry.type === "proc") args.push("--proc", entry.dst);
    else if (entry.type === "dev") args.push("--dev", entry.dst);
  }
  for (const dst of plan.tmpfs) args.push("--tmpfs", dst);
  for (const bind of plan.binds) args.push(bind.mode === "rw" ? "--bind" : "--ro-bind", bind.src, bind.dst);
  args.push("--chdir", plan.chdir);
  return args;
}

/**
 * Seatbelt is a deny-list mechanism, so the macOS rendering hides the roots
 * that hold private material (denyRead, carved out by the host) and allows
 * reads of the plan's binds. Later rules win.
 */
export function renderSeatbeltProfile(plan: MountPlan): string {
  if (plan.platform !== "darwin") throw new Error("Seatbelt profiles can only be rendered for macOS plans");
  const lines = ["(version 1)", "(allow default)"];
  if (plan.network === "none") lines.push("(deny network*)");
  else lines.push('(deny network-outbound (remote ip "localhost:*"))');
  const denyRead = [...plan.denyRead].sort().map(subpath);
  if (denyRead.length > 0) lines.push(`(deny file-read* ${denyRead.join(" ")})`);
  const readAllow = plan.binds.map((bind) => subpath(bind.src));
  if (readAllow.length > 0) lines.push(`(allow file-read* ${readAllow.join(" ")})`);
  lines.push("(deny file-write*)");
  const writeAllow = ['(literal "/dev/null")', ...plan.darwinWriteRoots.map(subpath), ...plan.binds.filter((bind) => bind.mode === "rw").map((bind) => subpath(bind.src))];
  lines.push(`(allow file-write* ${writeAllow.join(" ")})`);
  return `${lines.join("\n")}\n`;
}

/**
 * Deny list for a root that contains allowed paths: every entry of every
 * directory on the way from the root to an allowed path is denied unless it
 * is itself (an ancestor of) an allowed path. listChildren(dir) returns the
 * entry names of a directory, or null when it cannot be listed, in which
 * case the whole directory is denied. Pure; the caller supplies the listings.
 */
export function carveOutDenies(root: string, allowedPaths: string[], listChildren: (dir: string) => string[] | null): string[] {
  const allowed = uniqueStrings(allowedPaths).filter((candidate) => isWithin(candidate, root));
  if (allowed.length === 0) return [root];
  const denies: string[] = [];
  const visit = (dir: string) => {
    if (allowed.includes(dir)) return;
    const children = listChildren(dir);
    if (!Array.isArray(children)) {
      denies.push(dir);
      return;
    }
    for (const name of children) {
      const child = path.join(dir, name);
      if (allowed.includes(child)) continue;
      if (allowed.some((candidate) => isWithin(candidate, child))) visit(child);
      else denies.push(child);
    }
  };
  visit(root);
  return denies;
}

export function mountPlanHash(plan: MountPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 16);
}

/** A short, human summary for the run page: what is readable, what is writable. */
export function describeMountPlan(plan: MountPlan): { readable: string[]; writable: string[]; network: SandboxNetwork } {
  return {
    readable: [
      ...plan.system.filter((entry) => entry.type === "ro-bind").map((entry) => (entry as { dst: string }).dst),
      ...plan.binds.filter((bind) => bind.mode === "ro").map((bind) => bind.dst),
    ],
    writable: plan.binds.filter((bind) => bind.mode === "rw").map((bind) => bind.dst),
    network: plan.network,
  };
}

function sortBinds(binds: MountBind[]): MountBind[] {
  // Parents before children so a child mount is not hidden by a later parent mount.
  return [...binds]
    .map((bind, index) => ({ bind, index, depth: bind.dst.split("/").length }))
    .sort((a, b) => a.depth - b.depth || a.bind.dst.localeCompare(b.bind.dst) || a.index - b.index)
    .map((entry) => entry.bind);
}

export function isWithin(candidate: string | null | undefined, root: string | null | undefined): boolean {
  if (!candidate || !root) return false;
  return candidate === root || candidate.startsWith(root.endsWith("/") ? root : `${root}/`);
}

function subpath(value: string): string {
  return `(subpath "${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}")`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}
