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
 * real home directory are absent rather than masked. On macOS the same holds
 * for reads: the Seatbelt profile denies every read and allows back only the
 * run folder (inputs are staged into it), the environment, the conda package
 * cache and a small, tested set of system paths.
 *
 * The plan format follows the one used by the agent runner (CAMI-agent,
 * automation/server/lib/mountPlan.js) so the two can share it later.
 */
export const MOUNT_PLAN_SCHEMA_VERSION = 2;

export type SandboxPlatform = "linux" | "darwin";
export type SandboxNetwork = "none" | "host";

export type BindPurpose = "system" | "environment" | "condaPackages" | "extra" | "run" | "control" | "logs";

const READ_ONLY_PURPOSES = new Set<BindPurpose>(["system", "environment", "condaPackages", "extra", "control", "logs"]);

/** Inside the run folder: the wrapper's own files, which the analysis must not change. */
export const CONTROL_SUBDIR = "control";
export const LOGS_SUBDIR = "logs";
export const INNER_SCRIPT_NAME = "analysis.sh";
const READ_WRITE_PURPOSES = new Set<BindPurpose>(["run"]);

const SYSTEM_DIRS = ["/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64"];

/**
 * Linux: the few files of /etc a conda R or Python needs (the dynamic
 * linker cache, the time zone, name lookup of the own user, Debian's
 * alternatives links, fontconfig). The rest of /etc is absent.
 */
export const LINUX_ETC_ENTRIES = [
  "/etc/ld.so.cache",
  "/etc/ld.so.conf",
  "/etc/ld.so.conf.d",
  "/etc/localtime",
  "/etc/timezone",
  "/etc/nsswitch.conf",
  "/etc/passwd",
  "/etc/group",
  "/etc/alternatives",
  "/etc/fonts",
];

/**
 * macOS: what dyld, bash, Rscript and the tools R shells out to (uname,
 * sh) need to read, found by running the seeded flows under a deny-all
 * profile and adding back one path per failure. Everything else, including
 * the whole home directory and /Users, /Volumes, /tmp and /private/etc, is
 * unreadable.
 */
export const DARWIN_SYSTEM_READ = {
  subpaths: [
    // frameworks, CoreServices/SystemVersion.plist (R reads it at startup)
    "/System/Library",
    "/bin",
    "/usr/bin",
    // without it R falls back to the C locale
    "/usr/share/locale",
    // the zone files /etc/localtime points into
    "/private/var/db/timezone",
  ],
  literals: [
    // dyld opens the root itself; a metadata-only rule aborts every process
    "/",
    // the /etc and /var symlinks, and the time zone link behind /etc/localtime
    "/etc",
    "/var",
    "/private/etc/localtime",
    // /bin/sh is a trampoline that reads the selected shell
    "/private/var/select/sh",
    "/dev/null",
    "/dev/zero",
    "/dev/random",
    "/dev/urandom",
    // bash names its standard streams and process substitutions <(...) >(...)
    // through these; they only reach descriptors the process already holds
    "/dev/stdin",
    "/dev/stdout",
    "/dev/stderr",
  ],
};

/**
 * macOS: descriptor paths a shell step reads and writes (process
 * substitution, `tee /dev/stderr`). /dev/fd/N is a descriptor the process
 * already has open, so allowing it opens nothing new.
 */
export const DARWIN_DESCRIPTOR_PATHS = ["/dev/fd"];

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
  /** A single file rather than a directory. */
  type?: "file" | "dir";
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
  /** tmpfs mounted inside a bind, after it, to hide part of it (Linux). */
  overlayTmpfs: string[];
  binds: MountBind[];
  /** Seatbelt only: system paths readable besides the binds (everything else is denied). */
  darwinSystemRead: { subpaths: string[]; literals: string[] };
  /**
   * Seatbelt only: the directories above each bind. Only their own metadata
   * is readable (stat, getcwd); their listings and other entries are not.
   */
  darwinTraverse: string[];
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
  const overlayTmpfs: string[] = [];
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
    for (const entry of LINUX_ETC_ENTRIES) {
      const found = input.host.system?.[entry];
      if (!found) continue;
      if (found.symlink) system.push({ type: "symlink", target: found.symlink, dst: entry });
      else if (found.exists) system.push({ type: "ro-bind", src: entry, dst: entry });
    }
    tmpfs.push("/tmp", "/var/tmp", "/run", "/var", "/home", "/root", "/opt");
    if (input.host.sss) binds.push({ src: "/var/lib/sss", dst: "/var/lib/sss", mode: "ro", purpose: "system" });
  }

  binds.push({ src: srcOf(runFolder), dst: runFolder, mode: "rw", purpose: "run" });
  // The audit record, the inner script and the log are written by the wrapper
  // outside the sandbox; inside they are read-only so the analysis cannot
  // rewrite what the run page reports. The wrapper keeps the log open, so
  // its own output still arrives through the inherited descriptors.
  const controlDir = path.join(runFolder, CONTROL_SUBDIR);
  const logsDir = path.join(runFolder, LOGS_SUBDIR);
  if (platform === "linux") {
    // A tmpfs over control/ hides the plan files; only the inner script is exposed.
    overlayTmpfs.push(controlDir);
    binds.push({ src: path.join(srcOf(runFolder), CONTROL_SUBDIR, INNER_SCRIPT_NAME), dst: path.join(controlDir, INNER_SCRIPT_NAME), mode: "ro", purpose: "control", type: "file" });
  } else {
    binds.push({ src: path.join(srcOf(runFolder), CONTROL_SUBDIR), dst: controlDir, mode: "ro", purpose: "control" });
  }
  binds.push({ src: path.join(srcOf(runFolder), LOGS_SUBDIR), dst: logsDir, mode: "ro", purpose: "logs" });
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
    overlayTmpfs,
    binds: sortBinds(binds),
    darwinSystemRead: platform === "darwin" ? { subpaths: [...DARWIN_SYSTEM_READ.subpaths], literals: [...DARWIN_SYSTEM_READ.literals] } : { subpaths: [], literals: [] },
    darwinTraverse: platform === "darwin" ? traverseDirs(binds.map((bind) => bind.src)) : [],
    // No shared temp on macOS either: TMPDIR points into the run folder, and
    // a shared /tmp would be a channel between runs of the same user.
    darwinWriteRoots: [],
  };
  validateMountPlan(plan, {
    runFolder: srcOf(runFolder),
    runsRoot: roots.runsRoot ? srcOf(roots.runsRoot) : null,
    datasetsRoot: roots.datasetsRoot ? srcOf(roots.datasetsRoot) : null,
    appDir: roots.appDir ? srcOf(roots.appDir) : null,
    hostHome: roots.hostHome ? srcOf(roots.hostHome) : null,
    exploreBase: roots.exploreBase ? srcOf(roots.exploreBase) : null,
  });
  return plan;
}

export interface PlanContext {
  runFolder: string;
  runsRoot?: string | null;
  datasetsRoot?: string | null;
  appDir?: string | null;
  hostHome?: string | null;
  exploreBase?: string | null;
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
  // Reads beyond the binds: system paths only, never the home directory or
  // the explore storage (the binds above are the run's own part of it).
  for (const entry of [...(plan.darwinSystemRead?.subpaths ?? []), ...(plan.darwinSystemRead?.literals ?? []).filter((value) => value !== "/")]) {
    if (!path.isAbsolute(entry)) errors.push(`system read path must be absolute: ${entry}`);
    for (const [name, root] of [["home directory", context.hostHome], ["explore storage", context.exploreBase], ["runs root", context.runsRoot], ["tables storage", context.datasetsRoot], ["application directory", context.appDir]] as const) {
      if (root && (isWithin(entry, root) || isWithin(root, entry))) errors.push(`system read path ${entry} overlaps the ${name}`);
    }
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
  // bubblewrap mounts in argument order: an overlay tmpfs goes after the bind
  // it hides part of and before any bind that reaches inside it.
  const pending = [...plan.overlayTmpfs];
  for (const bind of plan.binds) {
    for (const overlay of [...pending]) {
      if (isWithin(bind.dst, overlay)) {
        args.push("--tmpfs", overlay);
        pending.splice(pending.indexOf(overlay), 1);
      }
    }
    args.push(bind.mode === "rw" ? "--bind" : "--ro-bind", bind.src, bind.dst);
  }
  for (const overlay of pending) args.push("--tmpfs", overlay);
  args.push("--chdir", plan.chdir);
  return args;
}

/**
 * The macOS rendering. Seatbelt evaluates the last matching rule, so the
 * profile denies every read first and then allows back the plan's system
 * paths and binds; writes are denied everywhere but the run folder. Later
 * rules win.
 */
export function renderSeatbeltProfile(plan: MountPlan): string {
  if (plan.platform !== "darwin") throw new Error("Seatbelt profiles can only be rendered for macOS plans");
  const lines = ["(version 1)", "(allow default)"];
  // Other applications must not act on the analysis's behalf: no Apple
  // Events (osascript could ask Finder to read a file outside the sandbox).
  lines.push("(deny appleevent-send)");
  if (plan.network === "none") lines.push("(deny network*)");
  else lines.push('(deny network-outbound (remote ip "localhost:*"))');
  lines.push("(deny file-read*)");
  const systemRead = [...plan.darwinSystemRead.literals.map(literal), ...plan.darwinSystemRead.subpaths.map(subpath)];
  if (systemRead.length > 0) lines.push(`(allow file-read* ${[...systemRead, ...DARWIN_DESCRIPTOR_PATHS.map(subpath)].join(" ")})`);
  // The directories above the run and the environment: stat and getcwd work,
  // listing them (and so learning the names of other runs) does not.
  if (plan.darwinTraverse.length > 0) lines.push(`(allow file-read-metadata ${plan.darwinTraverse.map(literal).join(" ")})`);
  const readAllow = plan.binds.map((bind) => subpath(bind.src));
  if (readAllow.length > 0) lines.push(`(allow file-read* ${readAllow.join(" ")})`);
  lines.push("(deny file-write*)");
  const writeAllow = ['(literal "/dev/null")', '(literal "/dev/stdout")', '(literal "/dev/stderr")', ...DARWIN_DESCRIPTOR_PATHS.map(subpath), ...plan.darwinWriteRoots.map(subpath), ...plan.binds.filter((bind) => bind.mode === "rw").map((bind) => subpath(bind.src))];
  lines.push(`(allow file-write* ${writeAllow.join(" ")})`);
  // The wrapper's files inside the writable run folder stay read-only, and
  // the plan files stay hidden apart from the inner script bash has to read.
  const guarded = plan.binds.filter((bind) => bind.purpose === "control" || bind.purpose === "logs");
  if (guarded.length > 0) lines.push(`(deny file-write* ${guarded.map((bind) => subpath(bind.src)).join(" ")})`);
  const control = plan.binds.find((bind) => bind.purpose === "control");
  if (control) {
    lines.push(`(deny file-read* ${subpath(control.src)})`);
    lines.push(`(allow file-read* ${literal(path.join(control.src, INNER_SCRIPT_NAME))})`);
  }
  return `${lines.join("\n")}\n`;
}

/** Every proper ancestor of the given paths, the root included, that is not itself inside one of them. Pure. */
export function traverseDirs(paths: string[]): string[] {
  const own = uniqueStrings(paths);
  const dirs = new Set<string>();
  for (const entry of own) {
    let dir = path.dirname(entry);
    while (true) {
      if (!own.some((candidate) => isWithin(dir, candidate))) dirs.add(dir);
      if (dir === "/" || dir === path.dirname(dir)) break;
      dir = path.dirname(dir);
    }
  }
  return [...dirs].sort();
}

export function mountPlanHash(plan: MountPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 16);
}

/** A short, human summary for the run page: what is readable, what is writable. */
export function describeMountPlan(plan: MountPlan): { readable: string[]; writable: string[]; network: SandboxNetwork } {
  return {
    readable: [
      ...plan.system.filter((entry) => entry.type === "ro-bind").map((entry) => (entry as { dst: string }).dst),
      ...(plan.darwinSystemRead?.subpaths ?? []),
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

function literal(value: string): string {
  return `(literal "${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}")`;
}

function subpath(value: string): string {
  return `(subpath "${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}")`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}
